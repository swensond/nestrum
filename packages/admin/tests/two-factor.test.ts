import { defineAuth, totpCode, totpSecretFromUri, totpStep } from '@nestrum/auth';
import type { AuthSession } from '@nestrum/core';
import { allow, defineApplication, deny } from '@nestrum/core';
import { createHonoRuntime } from '@nestrum/hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { storage } from '../../auth/tests/fixtures.js';
import type { AdminOptions } from '../src/index.js';
import { defineAdmin, resolveTwoFactorPolicy, sessionAssurance } from '../src/index.js';

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
const cookieOf = (response: Response) =>
    response.headers
        .getSetCookie()
        .filter((value) => !/=;|Max-Age=0/i.test(value))
        .map((value) => value.split(';')[0])
        .join('; ');

async function setup(admin: AdminOptions = { security: { twoFactor: { assuranceTtlSeconds: TTL } } }) {
    const memory = storage();
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
        }),
        admin: defineAdmin(admin),
        policies: [
            {
                resource: 'admin.access',
                actions: { access: { authorize: ({ subject }) => (subject.staff ? allow() : deny('NOT_STAFF')) } },
            },
        ],
    });
    const runtime = createHonoRuntime({ application, onError: () => {} });
    await runtime.start();
    const call = (path: string, init?: RequestInit) => runtime.fetch(new Request(`${BASE_URL}${path}`, init));
    const admin$ = (cookie: string) => call('/__admin/resources', { headers: { cookie } });
    async function signUp(email: string) {
        const response = await call(
            '/api/auth/sign-up/email',
            json('POST', { name: 'User', email, password: PASSWORD }),
        );
        expect(response.status).toBe(200);

        return cookieOf(response);
    }
    /** Enables TOTP and verifies it; returns the verified session cookie, secret and backup codes. */
    async function enroll(cookie: string) {
        const enabled = await call('/api/auth/two-factor/enable', json('POST', { password: PASSWORD }, cookie));
        const { totpURI, backupCodes } = (await enabled.json()) as { totpURI: string; backupCodes: string[] };
        const secret = totpSecretFromUri(totpURI);
        const verified = await call(
            '/api/auth/two-factor/verify-totp',
            json('POST', { code: totpCode(secret, totpStep(Date.now())) }, cookie),
        );
        expect(verified.status).toBe(200);

        return { cookie: cookieOf(verified), secret, backupCodes };
    }
    /** Signs in and completes the second factor with a TOTP for the next step (the previous step may be spent). */
    async function signInWithTotp(email: string, secret: string) {
        const login = await call('/api/auth/sign-in/email', json('POST', { email, password: PASSWORD }));
        expect(await login.json()).toMatchObject({ twoFactorRedirect: true });
        const verified = await call(
            '/api/auth/two-factor/verify-totp',
            json('POST', { code: totpCode(secret, totpStep(Date.now())) }, cookieOf(login)),
        );
        expect(verified.status).toBe(200);

        return cookieOf(verified);
    }

    return { call, admin$, signUp, enroll, signInWithTotp, application };
}

afterEach(() => vi.useRealTimers());

describe('Admin 2FA policy configuration', () => {
    it('defaults to required with a 12 hour limit', () => {
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

describe('Session assurance rules', () => {
    const policy = { required: true, assuranceTtlSeconds: 600 };
    const now = Date.UTC(2026, 0, 1, 12);
    const session = (overrides: { user?: object; session?: object } = {}): AuthSession => ({
        user: { id: 'u', twoFactorEnabled: true, updatedAt: new Date(now - 3_600_000), ...overrides.user },
        session: {
            id: 's',
            userId: 'u',
            createdAt: new Date(now - 60_000),
            expiresAt: new Date(now + 60_000),
            ...overrides.session,
        },
    });

    it('is satisfied only for an enrolled user with a session that is newer than the user and inside the TTL', () => {
        expect(sessionAssurance(session(), policy, now)).toBe('satisfied');
        // Same instant as the enrollment update is what the plugin can produce for the verified session.
        expect(sessionAssurance(session({ user: { updatedAt: new Date(now - 60_000) } }), policy, now)).toBe(
            'satisfied',
        );
    });

    it.each([
        ['no factor', { user: { twoFactorEnabled: false } }, 'setup-required'],
        ['factor state missing', { user: { twoFactorEnabled: undefined } }, 'setup-required'],
        ['session predates the user update', { user: { updatedAt: new Date(now - 30_000) } }, 'challenge-required'],
        ['older than the TTL', { session: { createdAt: new Date(now - 600_000) } }, 'challenge-required'],
        ['missing session time', { session: { createdAt: undefined } }, 'challenge-required'],
        ['unparsable session time', { session: { createdAt: 'never' } }, 'challenge-required'],
        ['missing user time', { user: { updatedAt: undefined } }, 'challenge-required'],
    ] as const)('denies %s', (_name, overrides, expected) => {
        expect(sessionAssurance(session(overrides), policy, now)).toBe(expected);
    });

    it('accepts ISO timestamps, as database drivers return them', () => {
        expect(
            sessionAssurance(
                session({
                    user: { updatedAt: new Date(now - 3_600_000).toISOString() },
                    session: { createdAt: new Date(now - 1_000).toISOString() },
                }),
                policy,
                now,
            ),
        ).toBe('satisfied');
    });
});

describe('Admin 2FA boundary', () => {
    it('denies unauthenticated requests before anything else', async () => {
        const { call } = await setup();
        expect((await call('/__admin/resources')).status).toBe(401);
    });

    it('requires setup for an authorized user without a factor', async () => {
        const { admin$, signUp } = await setup();
        const cookie = await signUp('staff@example.com');
        const denied = await admin$(cookie);
        expect(denied.status).toBe(403);
        expect(await denied.json()).toEqual({
            error: {
                code: 'ADMIN_2FA_REQUIRED',
                message: 'Admin access requires two-factor verification.',
                reason: 'setup-required',
            },
        });
    });

    it('reveals nothing about factor state to users without admin.access', async () => {
        const { admin$, signUp } = await setup();
        const denied = await admin$(await signUp('member@example.com'));
        expect(denied.status).toBe(403);
        expect(await denied.json()).toMatchObject({ error: { reason: 'NOT_STAFF' } });
    });

    it('admits the session that verified enrollment, but not one created before it', async () => {
        const { admin$, signUp, enroll, call } = await setup();
        const first = await signUp('staff@example.com');
        const before = cookieOf(
            await call('/api/auth/sign-in/email', json('POST', { email: 'staff@example.com', password: PASSWORD })),
        );
        expect((await admin$(before)).status).toBe(403);
        const { cookie } = await enroll(first);
        expect((await admin$(cookie)).status).toBe(200);
        // A single-factor session that already existed when 2FA was enabled must not become an admin session.
        const stale = await admin$(before);
        expect(stale.status).toBe(403);
        expect(await stale.json()).toMatchObject({ error: { reason: 'challenge-required' } });
    });

    it('requires a code at every sign-in and enforces ABAC after it', async () => {
        const { admin$, signUp, enroll, signInWithTotp, call } = await setup();
        const first = await signUp('staff@example.com');
        const { secret } = await enroll(first);
        // Signing in without the second factor yields no session at all.
        const login = await call(
            '/api/auth/sign-in/email',
            json('POST', { email: 'staff@example.com', password: PASSWORD }),
        );
        expect(await login.json()).toMatchObject({ twoFactorRedirect: true });
        expect((await admin$(cookieOf(login))).status).toBe(401);
        expect((await admin$(await signInWithTotp('staff@example.com', secret))).status).toBe(200);

        // A verified user who is not staff stays denied by admin.access.
        const memberCookie = await signUp('member@example.com');
        const member = await enroll(memberCookie);
        expect((await admin$(member.cookie)).status).toBe(403);
        expect(await (await admin$(member.cookie)).json()).toMatchObject({ error: { reason: 'NOT_STAFF' } });
    });

    it('requires signing in again once the two-factor session is older than the limit', async () => {
        vi.useFakeTimers({ toFake: ['Date'], now: Date.now() });
        const { admin$, signUp, enroll, call, signInWithTotp } = await setup();
        const { cookie, secret } = await enroll(await signUp('staff@example.com'));
        vi.setSystemTime(Date.now() + TTL * 1000 - 1000);
        expect((await admin$(cookie)).status).toBe(200);
        vi.setSystemTime(Date.now() + 1000);
        const expired = await admin$(cookie);
        expect(expired.status).toBe(403);
        expect(await expired.json()).toMatchObject({ error: { reason: 'challenge-required' } });
        // The login session itself is untouched; only admin access needs a fresh verified sign-in.
        expect(await (await call('/api/auth/get-session', { headers: { cookie } })).json()).not.toBeNull();
        vi.setSystemTime(Date.now() + 30_000);
        expect((await admin$(await signInWithTotp('staff@example.com', secret))).status).toBe(200);
    });

    it('accepts a backup code as the second factor exactly once', async () => {
        const { admin$, signUp, enroll, call } = await setup();
        const { backupCodes } = await enroll(await signUp('staff@example.com'));
        const signIn = async () =>
            cookieOf(
                await call('/api/auth/sign-in/email', json('POST', { email: 'staff@example.com', password: PASSWORD })),
            );
        const used = await call(
            '/api/auth/two-factor/verify-backup-code',
            json('POST', { code: backupCodes[0] }, await signIn()),
        );
        expect(used.status).toBe(200);
        expect((await admin$(cookieOf(used))).status).toBe(200);
        const reused = await call(
            '/api/auth/two-factor/verify-backup-code',
            json('POST', { code: backupCodes[0] }, await signIn()),
        );
        expect(reused.status).toBe(401);
    });

    it('keeps same-origin enforcement in front of assurance', async () => {
        const { call, signUp } = await setup();
        const cookie = await signUp('staff@example.com');
        const cross = await call('/__admin/resources', {
            headers: { origin: 'https://evil.example', cookie },
        });
        expect(cross.status).toBe(403);
        expect(await cross.json()).toMatchObject({ error: { code: 'ADMIN_ORIGIN_DENIED' } });
    });

    it('fails closed for alternate spellings of admin routes', async () => {
        const { call, signUp } = await setup();
        const cookie = await signUp('staff@example.com');
        for (const path of ['/__admin/resources/', '/__admin//resources', '/__admin/auth/2fa/status']) {
            expect((await call(path, { headers: { cookie } })).status).not.toBe(200);
        }
    });

    it('does not enforce assurance when explicitly disabled', async () => {
        const { admin$, signUp } = await setup({ security: { twoFactor: { required: false } } });
        expect((await admin$(await signUp('staff@example.com'))).status).toBe(200);
    });
});
