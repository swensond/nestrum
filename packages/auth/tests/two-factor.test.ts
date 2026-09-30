import type { Authentication, AuthSession } from '@nestrum/core';
import { defineApplication } from '@nestrum/core';
import { createHonoRuntime } from '@nestrum/hono';
import { describe, expect, it } from 'vitest';
import {
    authContract,
    defineAuth,
    LOCKOUT_SECONDS,
    MAX_FAILED_ATTEMPTS,
    RECOVERY_CODE_COUNT,
    TOTP_PERIOD_SECONDS,
    totpCode,
    totpStep,
} from '../src/index.js';
import { createTwoFactorKeys, generateRecoveryCode } from '../src/two-factor/crypto.js';
import { base32Decode, base32Encode, matchTotp } from '../src/two-factor/totp.js';
import { storage } from './fixtures.js';

const BASE_URL = 'http://localhost:3000';
const SECRET = 'nestrum-test-secret-longer-than-thirty-two-characters';
const TTL = 3600;

async function setup(email = 'a@example.test') {
    const memory = storage();
    const clock = { now: Date.UTC(2026, 0, 1, 12, 0, 0) };
    const application = defineApplication({
        apps: [],
        databases: {
            default: { kind: 'prisma', provider: 'postgresql', connection: 'unused' },
            identity: { kind: 'prisma', provider: 'postgresql', connection: 'unused' },
        },
        auth: defineAuth({
            database: 'identity',
            baseURL: BASE_URL,
            secret: SECRET,
            prisma: () => memory.binding,
            twoFactor: { issuer: 'Example', now: () => clock.now },
        }),
    });
    const runtime = createHonoRuntime({ application });
    await runtime.start();
    const signup = await runtime.fetch(
        new Request(`${BASE_URL}/api/auth/sign-up/email`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: BASE_URL },
            body: JSON.stringify({ email, password: 'correct horse battery', name: 'A' }),
        }),
    );
    const cookie = signup.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; ');
    const auth = application.auth as Authentication;
    const session = (await auth.getSession(new Request(BASE_URL, { headers: { cookie } }))) as AuthSession;

    return { auth, memory, clock, session, twoFactor: auth.twoFactor };
}

describe('TOTP primitives', () => {
    it('matches RFC 6238 vectors and rejects malformed or out-of-window codes', () => {
        const secret = base32Encode(Buffer.from('12345678901234567890'));
        expect(base32Decode(secret).toString()).toBe('12345678901234567890');
        expect(totpCode(secret, totpStep(59_000)).endsWith('287082')).toBe(true);
        expect(totpCode(secret, totpStep(1_111_111_109_000)).endsWith('081804')).toBe(true);
        const now = 1_111_111_109_000;
        expect(matchTotp(secret, '081804', now)).toBe(totpStep(now));
        expect(matchTotp(secret, '081804', now + TOTP_PERIOD_SECONDS * 3000)).toBeUndefined();
        expect(matchTotp(secret, '08180', now)).toBeUndefined();
        expect(matchTotp(secret, 'abcdef', now)).toBeUndefined();
    });

    it('seals secrets and hashes recovery codes without exposing plaintext', () => {
        const keys = createTwoFactorKeys(SECRET);
        const sealed = keys.encrypt('JBSWY3DPEHPK3PXP');
        expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
        expect(keys.decrypt(sealed)).toBe('JBSWY3DPEHPK3PXP');
        expect(() => keys.decrypt(`${sealed.slice(0, -2)}AA`)).toThrow();
        expect(() => createTwoFactorKeys(`${SECRET}x`).decrypt(sealed)).toThrow();
        const code = generateRecoveryCode();
        expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
        expect(keys.hashRecoveryCode(code)).toBe(keys.hashRecoveryCode(code.toLowerCase().replaceAll('-', ' ')));
        expect(keys.hashRecoveryCode(code)).not.toContain(code.replaceAll('-', ''));
    });
});

describe('Two-factor contract', () => {
    it('adds framework-owned models with a session cascade only where relations exist', () => {
        const postgres = authContract('postgresql', {});
        expect(postgres).toContain('model AdminAssurance');
        expect(postgres).toContain('session Session @relation(fields: [sessionId]');
        expect(postgres).toContain('model TwoFactorFactor');
        expect(postgres).toContain('model TwoFactorRecoveryCode');
        expect(authContract('mongodb', {})).not.toContain('session Session @relation');
    });
});

describe('Session assurance', () => {
    it('reports unconfigured, configured-but-unverified, verified and expired states independently of login', async () => {
        const { twoFactor, session, clock } = await setup();
        expect(await twoFactor.assurance(session)).toEqual({ level: 'single-factor', configured: false });
        const enrollment = await twoFactor.beginEnrollment(session);
        // A generated but unconfirmed secret is never configuration or assurance.
        expect(await twoFactor.assurance(session)).toEqual({ level: 'single-factor', configured: false });
        const grant = await twoFactor.confirmEnrollment(session, totpCode(enrollment.secret, totpStep(clock.now)), TTL);
        expect(grant.assurance).toMatchObject({ level: 'two-factor', configured: true, method: 'totp' });
        expect(grant.assurance.expiresAt?.getTime()).toBe(clock.now + TTL * 1000);
        expect((await twoFactor.assurance(session)).level).toBe('two-factor');
        clock.now += TTL * 1000 - 1;
        expect((await twoFactor.assurance(session)).level).toBe('two-factor');
        clock.now += 1;
        // Expiry is exclusive: the session is still valid but assurance is not, and the factor stays configured.
        expect(await twoFactor.assurance(session)).toEqual({ level: 'single-factor', configured: true });
    });

    it('does not carry assurance to another session of the same user', async () => {
        const { twoFactor, session, clock, auth } = await setup();
        const enrollment = await twoFactor.beginEnrollment(session);
        await twoFactor.confirmEnrollment(session, totpCode(enrollment.secret, totpStep(clock.now)), TTL);
        const other: AuthSession = { user: session.user, session: { ...session.session, id: 'another-session' } };
        expect(await auth.twoFactor.assurance(other)).toEqual({ level: 'single-factor', configured: true });
    });
});

describe('Enrollment', () => {
    it('stores only an encrypted secret, activates after a valid code and issues hashed one-time recovery codes', async () => {
        const { twoFactor, session, clock, memory } = await setup();
        const enrollment = await twoFactor.beginEnrollment(session);
        expect(enrollment.otpauthUri).toContain('otpauth://totp/Example:a%40example.test');
        expect(enrollment.otpauthUri).toContain(`secret=${enrollment.secret}`);
        const [row] = memory.records.TwoFactorFactor;
        expect(row?.confirmedAt).toBeNull();
        expect(JSON.stringify(row)).not.toContain(enrollment.secret);

        await expect(twoFactor.confirmEnrollment(session, '000000', TTL)).rejects.toMatchObject({
            code: 'TWO_FACTOR_INVALID_CODE',
            status: 400,
        });
        expect(memory.records.TwoFactorFactor[0]?.confirmedAt).toBeNull();
        expect(memory.records.AdminAssurance).toHaveLength(0);

        const grant = await twoFactor.confirmEnrollment(session, totpCode(enrollment.secret, totpStep(clock.now)), TTL);
        expect(memory.records.TwoFactorFactor[0]?.confirmedAt).not.toBeNull();
        expect(grant.recoveryCodes).toHaveLength(RECOVERY_CODE_COUNT);
        const stored = JSON.stringify(memory.records.TwoFactorRecoveryCode);
        for (const code of grant.recoveryCodes ?? []) {
            expect(stored).not.toContain(code);
            expect(stored).not.toContain(code.replaceAll('-', ''));
        }
        await expect(twoFactor.beginEnrollment(session)).rejects.toMatchObject({
            code: 'TWO_FACTOR_ALREADY_CONFIGURED',
        });
    });

    it('requires an enrollment before confirmation and replaces an abandoned pending secret', async () => {
        const { twoFactor, session, clock } = await setup();
        await expect(twoFactor.confirmEnrollment(session, '123456', TTL)).rejects.toMatchObject({
            code: 'TWO_FACTOR_ENROLLMENT_NOT_STARTED',
        });
        const first = await twoFactor.beginEnrollment(session);
        const second = await twoFactor.beginEnrollment(session);
        expect(second.secret).not.toBe(first.secret);
        await expect(
            twoFactor.confirmEnrollment(session, totpCode(first.secret, totpStep(clock.now)), TTL),
        ).rejects.toMatchObject({ code: 'TWO_FACTOR_INVALID_CODE' });
        await expect(
            twoFactor.confirmEnrollment(session, totpCode(second.secret, totpStep(clock.now)), TTL),
        ).resolves.toBeDefined();
    });
});

async function enrolled() {
    const context = await setup();
    const enrollment = await context.twoFactor.beginEnrollment(context.session);
    const grant = await context.twoFactor.confirmEnrollment(
        context.session,
        totpCode(enrollment.secret, totpStep(context.clock.now)),
        TTL,
    );

    return { ...context, secret: enrollment.secret, codes: grant.recoveryCodes ?? [] };
}

describe('Challenge', () => {
    it('accepts a valid TOTP, rejects invalid ones and rejects replay of a used time step', async () => {
        const { twoFactor, session, clock, secret } = await enrolled();
        clock.now += TOTP_PERIOD_SECONDS * 2000;
        await expect(twoFactor.verifyTotp(session, '000000', TTL)).rejects.toMatchObject({
            code: 'TWO_FACTOR_INVALID_CODE',
        });
        const code = totpCode(secret, totpStep(clock.now));
        expect((await twoFactor.verifyTotp(session, code, TTL)).assurance.level).toBe('two-factor');
        await expect(twoFactor.verifyTotp(session, code, TTL)).rejects.toMatchObject({
            code: 'TWO_FACTOR_INVALID_CODE',
        });
    });

    it('rejects the code used to confirm enrollment when replayed as the first challenge', async () => {
        const { twoFactor, session, clock, secret } = await enrolled();
        await expect(twoFactor.verifyTotp(session, totpCode(secret, totpStep(clock.now)), TTL)).rejects.toMatchObject({
            code: 'TWO_FACTOR_INVALID_CODE',
        });
    });

    it('refuses challenges without a configured factor', async () => {
        const { twoFactor, session } = await setup();
        await expect(twoFactor.verifyTotp(session, '123456', TTL)).rejects.toMatchObject({
            code: 'TWO_FACTOR_NOT_CONFIGURED',
        });
        await twoFactor.beginEnrollment(session);
        await expect(twoFactor.verifyRecovery(session, 'AAAA-AAAA-AAAA', TTL)).rejects.toMatchObject({
            code: 'TWO_FACTOR_NOT_CONFIGURED',
        });
    });

    it('locks after repeated failures, reports it before evaluating codes, and recovers after the lockout', async () => {
        const { twoFactor, session, clock, secret } = await enrolled();
        clock.now += TOTP_PERIOD_SECONDS * 2000;
        for (let attempt = 1; attempt < MAX_FAILED_ATTEMPTS; attempt += 1) {
            await expect(twoFactor.verifyTotp(session, '000000', TTL)).rejects.toMatchObject({ status: 400 });
        }
        await expect(twoFactor.verifyTotp(session, '000000', TTL)).rejects.toMatchObject({
            code: 'TWO_FACTOR_LOCKED',
            status: 429,
        });
        // Even the correct code and a recovery attempt are refused while locked.
        const valid = totpCode(secret, totpStep(clock.now));
        await expect(twoFactor.verifyTotp(session, valid, TTL)).rejects.toMatchObject({ code: 'TWO_FACTOR_LOCKED' });
        await expect(twoFactor.verifyRecovery(session, 'AAAA-AAAA-AAAA', TTL)).rejects.toMatchObject({
            code: 'TWO_FACTOR_LOCKED',
        });
        clock.now += LOCKOUT_SECONDS * 1000;
        expect((await twoFactor.verifyTotp(session, totpCode(secret, totpStep(clock.now)), TTL)).assurance.level).toBe(
            'two-factor',
        );
    });

    it('resets the failure counter after a success', async () => {
        const { twoFactor, session, clock, secret } = await enrolled();
        clock.now += TOTP_PERIOD_SECONDS * 2000;
        for (let attempt = 1; attempt < MAX_FAILED_ATTEMPTS; attempt += 1) {
            await expect(twoFactor.verifyTotp(session, '000000', TTL)).rejects.toMatchObject({ status: 400 });
        }
        await twoFactor.verifyTotp(session, totpCode(secret, totpStep(clock.now)), TTL);
        await expect(twoFactor.verifyTotp(session, '000000', TTL)).rejects.toMatchObject({ status: 400 });
    });
});

describe('Recovery codes', () => {
    it('accepts each code once, tolerates formatting, and reports remaining codes', async () => {
        const { twoFactor, session, codes, memory } = await enrolled();
        const [code, second] = codes as [string, string];
        const grant = await twoFactor.verifyRecovery(session, code.toLowerCase().replaceAll('-', ' '), TTL);
        expect(grant.assurance).toMatchObject({ level: 'two-factor', method: 'recovery' });
        expect(grant.recoveryCodesRemaining).toBe(RECOVERY_CODE_COUNT - 1);
        expect(memory.records.TwoFactorRecoveryCode.filter((row) => row.usedAt !== null)).toHaveLength(1);
        await expect(twoFactor.verifyRecovery(session, code, TTL)).rejects.toMatchObject({
            code: 'TWO_FACTOR_INVALID_CODE',
        });
        await expect(twoFactor.verifyRecovery(session, second, TTL)).resolves.toBeDefined();
        await expect(twoFactor.verifyRecovery(session, 'not-a-code', TTL)).rejects.toMatchObject({ status: 400 });
    });

    it('does not accept another user’s recovery code', async () => {
        const first = await enrolled();
        const other = await setup('b@example.test');
        const enrollment = await other.twoFactor.beginEnrollment(other.session);
        await other.twoFactor.confirmEnrollment(
            other.session,
            totpCode(enrollment.secret, totpStep(other.clock.now)),
            TTL,
        );
        await expect(
            other.twoFactor.verifyRecovery(other.session, first.codes[0] as string, TTL),
        ).rejects.toMatchObject({ code: 'TWO_FACTOR_INVALID_CODE' });
    });

    it('regeneration invalidates the previous set and stores only hashes', async () => {
        const { twoFactor, session, codes, memory } = await enrolled();
        const regenerated = await twoFactor.regenerateRecoveryCodes(session);
        expect(regenerated).toHaveLength(RECOVERY_CODE_COUNT);
        expect(memory.records.TwoFactorRecoveryCode).toHaveLength(RECOVERY_CODE_COUNT);
        await expect(twoFactor.verifyRecovery(session, codes[0] as string, TTL)).rejects.toMatchObject({
            code: 'TWO_FACTOR_INVALID_CODE',
        });
        await expect(twoFactor.verifyRecovery(session, regenerated[0] as string, TTL)).resolves.toBeDefined();
        expect(JSON.stringify(memory.records.TwoFactorRecoveryCode)).not.toContain(
            (regenerated[1] as string).replaceAll('-', ''),
        );
    });

    it('requires a configured factor to regenerate', async () => {
        const { twoFactor, session } = await setup();
        await expect(twoFactor.regenerateRecoveryCodes(session)).rejects.toMatchObject({
            code: 'TWO_FACTOR_NOT_CONFIGURED',
        });
    });
});
