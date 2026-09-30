import { defineAuth, totpCode, totpStep } from '@nestrum/auth';
import { allow, defineApplication, deny } from '@nestrum/core';
import { createHonoRuntime } from '@nestrum/hono';
import { describe, expect, it } from 'vitest';
import { storage } from '../../auth/tests/fixtures.js';
import type { AdminOptions } from '../src/index.js';
import { defineAdmin, resolveTwoFactorPolicy } from '../src/index.js';

const BASE_URL = 'http://localhost:3000';
const PASSWORD = 'a-valid-password-123';
const TTL = 600;

function json(method: string, value?: unknown, cookie?: string): RequestInit {
    return {
        method,
        headers: {
            ...(value === undefined ? {} : { 'content-type': 'application/json' }),
            origin: BASE_URL,
            ...(cookie ? { cookie } : {}),
        },
        ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    };
}

async function setup(admin: AdminOptions = { security: { twoFactor: { assuranceTtlSeconds: TTL } } }) {
    const memory = storage();
    const clock = { now: Date.now() };
    const application = defineApplication({
        apps: [],
        databases: {
            default: { kind: 'prisma', provider: 'postgresql', connection: 'unused' },
            identity: { kind: 'prisma', provider: 'postgresql', connection: 'unused' },
        },
        auth: defineAuth({
            database: 'identity',
            baseURL: BASE_URL,
            secret: 'nestrum-admin-test-secret-longer-than-thirty-two-characters',
            prisma: () => memory.binding,
            subjectFactory: ({ user }) => ({ id: user.id, staff: String(user.email).startsWith('staff') }),
            twoFactor: { now: () => clock.now },
        }),
        admin: defineAdmin(admin),
        policies: [
            {
                resource: 'admin.access',
                actions: { access: { authorize: ({ subject }) => (subject.staff ? allow() : deny('NOT_STAFF')) } },
            },
        ],
    });
    const runtime = createHonoRuntime({ application });
    await runtime.start();
    const call = (path: string, init?: RequestInit) => runtime.fetch(new Request(`${BASE_URL}${path}`, init));
    const cookieOf = (response: Response) =>
        response.headers
            .getSetCookie()
            .map((value) => value.split(';')[0])
            .join('; ');
    async function signUp(email: string) {
        const response = await call(
            '/api/auth/sign-up/email',
            json('POST', { name: 'User', email, password: PASSWORD }),
        );
        expect(response.status).toBe(200);

        return cookieOf(response);
    }
    async function signIn(email: string) {
        const response = await call('/api/auth/sign-in/email', json('POST', { email, password: PASSWORD }));
        expect(response.status).toBe(200);

        return cookieOf(response);
    }
    async function enroll(cookie: string) {
        const started = await call('/__admin/auth/2fa/enroll/start', json('POST', {}, cookie));
        const { secret } = (await started.json()) as { secret: string };
        const confirmed = await call(
            '/__admin/auth/2fa/enroll/confirm',
            json('POST', { code: totpCode(secret, totpStep(clock.now)) }, cookie),
        );
        const { recoveryCodes } = (await confirmed.json()) as { recoveryCodes: string[] };

        return { secret, recoveryCodes, confirmed };
    }

    return { call, clock, memory, signUp, signIn, enroll, application };
}

describe('Admin 2FA policy configuration', () => {
    it('defaults to required with a 12 hour assurance TTL', () => {
        expect(resolveTwoFactorPolicy()).toEqual({ required: true, assuranceTtlSeconds: 43_200 });
        expect(resolveTwoFactorPolicy({})).toEqual({ required: true, assuranceTtlSeconds: 43_200 });
        expect(defineAdmin().security.twoFactor).toEqual({ required: true, assuranceTtlSeconds: 43_200 });
        expect(resolveTwoFactorPolicy({ twoFactor: { required: false } }).required).toBe(false);
        expect(resolveTwoFactorPolicy({ twoFactor: { assuranceTtlSeconds: 900 } }).assuranceTtlSeconds).toBe(900);
    });

    it.each([
        { twoFactor: { required: 'yes' } },
        { twoFactor: { assuranceTtlSeconds: 0 } },
        { twoFactor: { assuranceTtlSeconds: 59 } },
        { twoFactor: { assuranceTtlSeconds: 1.5 } },
        { twoFactor: { assuranceTtlSeconds: 2_592_001 } },
        { twoFactor: { assuranceTtlSeconds: '600' } },
        { twoFactor: { extra: true } },
        { other: true },
        null,
        [],
    ])('rejects invalid security configuration %j', (security) => {
        expect(() => resolveTwoFactorPolicy(security as never)).toThrow(
            expect.objectContaining({ code: 'ADMIN_CONFIG_INVALID' }),
        );
    });

    it('validates the TTL even when 2FA is disabled', () => {
        expect(() => defineAdmin({ security: { twoFactor: { required: false, assuranceTtlSeconds: 1 } } })).toThrow();
    });
});

describe('Admin 2FA boundary', () => {
    it('denies unauthenticated requests to admin and 2FA routes before anything else', async () => {
        const { call } = await setup();
        for (const path of ['/__admin/resources', '/__admin/auth/2fa/status']) {
            expect((await call(path)).status).toBe(401);
        }
        expect((await call('/__admin/auth/2fa/challenge', json('POST', { code: '123456' }))).status).toBe(401);
    });

    it('requires setup for an authorized user without a factor while leaving only enrollment reachable', async () => {
        const { call, signUp } = await setup();
        const cookie = await signUp('staff@example.com');
        const denied = await call('/__admin/resources', { headers: { cookie } });
        expect(denied.status).toBe(403);
        expect(await denied.json()).toEqual({
            error: {
                code: 'ADMIN_2FA_REQUIRED',
                message: 'Admin access requires two-factor verification.',
                reason: 'setup-required',
            },
        });
        const status = await call('/__admin/auth/2fa/status', { headers: { cookie } });
        expect(status.status).toBe(200);
        expect(status.headers.get('cache-control')).toBe('no-store');
        expect(await status.json()).toEqual({ required: true, level: 'single-factor', configured: false });
        // Recovery regeneration and every ordinary route stay behind the assurance boundary.
        expect((await call('/__admin/auth/2fa/recovery/regenerate', json('POST', {}, cookie))).status).toBe(403);
        expect((await call('/__admin/nothing', { headers: { cookie } })).status).toBe(403);
    });

    it('reveals nothing about factor state to users without admin.access, and grants nothing to them', async () => {
        const { call, signUp } = await setup();
        const cookie = await signUp('member@example.com');
        for (const [path, init] of [
            ['/__admin/resources', { headers: { cookie } }],
            ['/__admin/auth/2fa/status', { headers: { cookie } }],
            ['/__admin/auth/2fa/enroll/start', json('POST', {}, cookie)],
            ['/__admin/auth/2fa/challenge', json('POST', { code: '123456' }, cookie)],
        ] as const) {
            const response = await call(path, init);
            expect(response.status).toBe(403);
            expect(await response.json()).toMatchObject({ error: { reason: 'NOT_STAFF' } });
        }
    });

    it('activates 2FA only after a valid code, then admits the enrolled session', async () => {
        const { call, signUp, memory, clock } = await setup();
        const cookie = await signUp('staff@example.com');
        const started = await call('/__admin/auth/2fa/enroll/start', json('POST', {}, cookie));
        expect(started.status).toBe(201);
        expect(started.headers.get('cache-control')).toBe('no-store');
        const { secret, otpauthUri } = (await started.json()) as { secret: string; otpauthUri: string };
        expect(otpauthUri).toContain(`secret=${secret}`);
        // An unconfirmed secret does not satisfy the boundary and reports setup as still required.
        expect((await call('/__admin/resources', { headers: { cookie } })).status).toBe(403);
        const wrong = await call('/__admin/auth/2fa/enroll/confirm', json('POST', { code: '000000' }, cookie));
        expect(wrong.status).toBe(400);
        expect(await wrong.json()).toMatchObject({ error: { code: 'TWO_FACTOR_INVALID_CODE' } });
        expect((await call('/__admin/resources', { headers: { cookie } })).status).toBe(403);
        const confirmed = await call(
            '/__admin/auth/2fa/enroll/confirm',
            json('POST', { code: totpCode(secret, totpStep(clock.now)) }, cookie),
        );
        expect(confirmed.status).toBe(200);
        expect(confirmed.headers.get('cache-control')).toBe('no-store');
        const body = (await confirmed.json()) as { assurance: { level: string }; recoveryCodes: string[] };
        expect(body.assurance.level).toBe('two-factor');
        expect(body.recoveryCodes).toHaveLength(10);
        expect((await call('/__admin/resources', { headers: { cookie } })).status).toBe(200);
        // Recovery codes are shown once: neither status nor storage reveals them again.
        const status = await (await call('/__admin/auth/2fa/status', { headers: { cookie } })).text();
        expect(status).not.toContain(body.recoveryCodes[0]);
        expect(JSON.stringify(memory.records)).not.toContain(body.recoveryCodes[0]?.replaceAll('-', ''));
    });

    it('requires a fresh challenge for a new login session and enforces ABAC after it', async () => {
        const { call, signUp, signIn, enroll, clock } = await setup();
        const first = await signUp('staff@example.com');
        const { secret } = await enroll(first);
        const second = await signIn('staff@example.com');
        const required = await call('/__admin/resources', { headers: { cookie: second } });
        expect(required.status).toBe(403);
        expect(await required.json()).toMatchObject({
            error: { code: 'ADMIN_2FA_REQUIRED', reason: 'challenge-required' },
        });
        // Assurance is per session: the first session stays verified while the second is still challenged.
        expect((await call('/__admin/resources', { headers: { cookie: first } })).status).toBe(200);

        clock.now += 60_000;
        const invalid = await call('/__admin/auth/2fa/challenge', json('POST', { code: '000000' }, second));
        expect(invalid.status).toBe(400);
        expect((await call('/__admin/resources', { headers: { cookie: second } })).status).toBe(403);
        const verified = await call(
            '/__admin/auth/2fa/challenge',
            json('POST', { code: totpCode(secret, totpStep(clock.now)) }, second),
        );
        expect(verified.status).toBe(200);
        expect((await call('/__admin/resources', { headers: { cookie: second } })).status).toBe(200);
    });

    it('re-challenges after the assurance TTL while the login session remains valid', async () => {
        const { call, signUp, enroll, clock } = await setup();
        const cookie = await signUp('staff@example.com');
        const { secret } = await enroll(cookie);
        clock.now += TTL * 1000 - 1;
        expect((await call('/__admin/resources', { headers: { cookie } })).status).toBe(200);
        clock.now += 1;
        const expired = await call('/__admin/resources', { headers: { cookie } });
        expect(expired.status).toBe(403);
        expect(await expired.json()).toMatchObject({ error: { reason: 'challenge-required' } });
        // The login session is intact: the Better Auth session endpoint still answers for it.
        expect((await call('/api/auth/get-session', { headers: { cookie } })).status).toBe(200);
        clock.now += 30_000;
        const again = await call(
            '/__admin/auth/2fa/challenge',
            json('POST', { code: totpCode(secret, totpStep(clock.now)) }, cookie),
        );
        expect(again.status).toBe(200);
        expect((await call('/__admin/resources', { headers: { cookie } })).status).toBe(200);
    });

    it('accepts each recovery code once and lets a recovered session regenerate codes', async () => {
        const { call, signUp, signIn, enroll } = await setup();
        const first = await signUp('staff@example.com');
        const { recoveryCodes } = await enroll(first);
        const second = await signIn('staff@example.com');
        const recovered = await call(
            '/__admin/auth/2fa/recovery/verify',
            json('POST', { code: recoveryCodes[0] }, second),
        );
        expect(recovered.status).toBe(200);
        expect(await recovered.json()).toMatchObject({
            assurance: { level: 'two-factor', method: 'recovery' },
            recoveryCodesRemaining: 9,
        });
        expect((await call('/__admin/resources', { headers: { cookie: second } })).status).toBe(200);
        const third = await signIn('staff@example.com');
        const reused = await call('/__admin/auth/2fa/recovery/verify', json('POST', { code: recoveryCodes[0] }, third));
        expect(reused.status).toBe(400);
        expect((await call('/__admin/resources', { headers: { cookie: third } })).status).toBe(403);

        const regenerated = await call('/__admin/auth/2fa/recovery/regenerate', json('POST', {}, second));
        expect(regenerated.status).toBe(200);
        expect(regenerated.headers.get('cache-control')).toBe('no-store');
        const fresh = ((await regenerated.json()) as { recoveryCodes: string[] }).recoveryCodes;
        expect(fresh).toHaveLength(10);
        const old = await call('/__admin/auth/2fa/recovery/verify', json('POST', { code: recoveryCodes[1] }, third));
        expect(old.status).toBe(400);
        const renewed = await call('/__admin/auth/2fa/recovery/verify', json('POST', { code: fresh[0] }, third));
        expect(renewed.status).toBe(200);
    });

    it('locks challenges after repeated failures without granting assurance', async () => {
        const { call, signUp, signIn, enroll, clock } = await setup();
        const first = await signUp('staff@example.com');
        const { secret } = await enroll(first);
        const second = await signIn('staff@example.com');
        clock.now += 60_000;
        let last: Response | undefined;
        for (let attempt = 0; attempt < 5; attempt += 1) {
            last = await call('/__admin/auth/2fa/challenge', json('POST', { code: '000000' }, second));
        }
        expect(last?.status).toBe(429);
        expect(await last?.json()).toMatchObject({ error: { code: 'TWO_FACTOR_LOCKED' } });
        const valid = await call(
            '/__admin/auth/2fa/challenge',
            json('POST', { code: totpCode(secret, totpStep(clock.now)) }, second),
        );
        expect(valid.status).toBe(429);
        expect((await call('/__admin/resources', { headers: { cookie: second } })).status).toBe(403);
    });

    it('keeps same-origin and request-shape enforcement on the 2FA routes', async () => {
        const { call, signUp } = await setup();
        const cookie = await signUp('staff@example.com');
        const cross = await call('/__admin/auth/2fa/enroll/start', {
            method: 'POST',
            headers: { origin: 'https://evil.example', cookie, 'content-type': 'application/json' },
            body: '{}',
        });
        expect(cross.status).toBe(403);
        expect(await cross.json()).toMatchObject({ error: { code: 'ADMIN_ORIGIN_DENIED' } });
        const form = await call('/__admin/auth/2fa/challenge', {
            method: 'POST',
            headers: { origin: BASE_URL, cookie, 'content-type': 'application/x-www-form-urlencoded' },
            body: 'code=123456',
        });
        expect(form.status).toBe(415);
        const extra = await call('/__admin/auth/2fa/challenge', json('POST', { code: '123456', admin: true }, cookie));
        expect(extra.status).toBe(400);
    });

    it('fails closed for alternate spellings of protected and challenge routes', async () => {
        const { call, signUp } = await setup();
        const cookie = await signUp('staff@example.com');
        for (const path of ['/__admin/resources/', '/__admin//resources', '/__admin/auth/2fa/status/']) {
            const response = await call(path, { headers: { cookie } });
            expect(response.status).not.toBe(200);
        }
    });

    it('does not enforce assurance when explicitly disabled', async () => {
        const { call, signUp } = await setup({ security: { twoFactor: { required: false } } });
        const cookie = await signUp('staff@example.com');
        expect((await call('/__admin/resources', { headers: { cookie } })).status).toBe(200);
        expect(await (await call('/__admin/auth/2fa/status', { headers: { cookie } })).json()).toMatchObject({
            required: false,
            level: 'single-factor',
        });
    });
});
