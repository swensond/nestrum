import { defineApplication } from '@nestrum/core';
import { createHonoRuntime } from '@nestrum/hono';
import { describe, expect, it } from 'vitest';
import { resolveApiKeyOptions } from '../src/api-keys/options.js';
import { createAuthInstance } from '../src/auth.js';
import {
    authContract,
    createPrismaAuthAdapter,
    defineAuth,
    totpCode,
    totpSecretFromUri,
    totpStep,
} from '../src/index.js';
import { resolveSsoOptions } from '../src/sso/options.js';
import { storage } from './fixtures.js';

const BASE_URL = 'http://localhost:3000';
const SECRET = 'nestrum-test-secret-longer-than-thirty-two-characters';
const PASSWORD = 'a-valid-password-123';

function post(path: string, body: object, cookie?: string) {
    return new Request(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE_URL, ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
    });
}
function cookies(response: Response): string {
    return response.headers
        .getSetCookie()
        .filter((value) => !/=;|Max-Age=0/i.test(value))
        .map((value) => value.split(';')[0])
        .join('; ');
}

async function setup(twoFactor: { maxFailedAttempts?: number } = {}) {
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
            secret: SECRET,
            prisma: () => memory.binding,
            twoFactor: { issuer: 'Example', ...twoFactor },
        }),
    });
    const runtime = createHonoRuntime({ application, onError: () => {} });
    await runtime.start();
    const call = (request: Request) => runtime.fetch(request);
    const signUp = async (email = 'a@example.test') => {
        const response = await call(post('/api/auth/sign-up/email', { name: 'A', email, password: PASSWORD }));
        expect(response.status).toBe(200);

        return cookies(response);
    };
    /** Enables and verifies TOTP on the given session; returns the secret and backup codes. */
    const enroll = async (cookie: string) => {
        const enabled = await call(post('/api/auth/two-factor/enable', { password: PASSWORD }, cookie));
        expect(enabled.status).toBe(200);
        const { totpURI, backupCodes } = (await enabled.json()) as { totpURI: string; backupCodes: string[] };
        const secret = totpSecretFromUri(totpURI);
        const verified = await call(
            post('/api/auth/two-factor/verify-totp', { code: totpCode(secret, totpStep(Date.now())) }, cookie),
        );
        expect(verified.status).toBe(200);

        // Verification replaces the enrolling session with a verified one; the browser keeps the new cookie.
        return { secret, backupCodes, totpURI, cookie: cookies(verified) };
    };
    const signIn = (email = 'a@example.test') => call(post('/api/auth/sign-in/email', { email, password: PASSWORD }));

    return { application, runtime, memory, call, signUp, enroll, signIn };
}

describe('Better Auth twoFactor plugin integration', () => {
    it('keeps the prebaked contracts in step with Better Auth’s own schema', async () => {
        const memory = storage();
        const instance = createAuthInstance({
            baseURL: BASE_URL,
            secret: SECRET,
            trustedOrigins: [],
            database: createPrismaAuthAdapter(memory.binding, 'postgresql'),
            issuer: 'Example',
            maxFailedAttempts: 10,
            lockoutSeconds: 900,
            apiKeys: resolveApiKeyOptions(undefined),
            sso: {
                options: resolveSsoOptions({ enabled: true, domainVerification: { enabled: true } }) as never,
                registry: () => undefined,
            },
        });
        const tables = (await instance.$context).tables as Record<
            string,
            { modelName: string; fields: Record<string, { fieldName?: string }> }
        >;
        const expected = Object.values(tables)
            .map(
                (table) =>
                    [
                        table.modelName,
                        ['id', ...Object.entries(table.fields).map(([key, f]) => f.fieldName ?? key)],
                    ] as const,
            )
            .sort(([left], [right]) => left.localeCompare(right));
        for (const provider of ['postgresql', 'mongodb'] as const) {
            const source = authContract(provider);
            const actual = [...source.matchAll(/^model (\w+) \{\n([\s\S]*?)^\}/gm)]
                .map(
                    ([, name, body]) =>
                        [
                            name,
                            (body ?? '')
                                .split('\n')
                                .map((line) => line.trim())
                                .filter((line) => line && !line.startsWith('@@') && !line.includes('@relation'))
                                .map((line) => line.split(/\s+/)[0]),
                        ] as const,
                )
                .sort(([left], [right]) => (left ?? '').localeCompare(right ?? ''));
            expect(actual.map(([name]) => name)).toEqual(expected.map(([name]) => name));
            for (const [index, [name, fields]] of actual.entries()) {
                expect([...(fields ?? [])].sort(), name).toEqual([...(expected[index]?.[1] ?? [])].sort());
            }
        }
    });

    it('starts users without a factor, keeps enrollment inactive until a valid code, then requires a code at sign-in', async () => {
        const { call, signUp, signIn, enroll, memory } = await setup();
        const cookie = await signUp();
        const enabled = await call(post('/api/auth/two-factor/enable', { password: PASSWORD }, cookie));
        expect(enabled.status).toBe(200);
        const body = (await enabled.json()) as { totpURI: string; backupCodes: string[] };
        expect(body.totpURI).toContain('otpauth://totp/Example');
        expect(body.backupCodes.length).toBeGreaterThan(0);
        const session = async () =>
            (await call(new Request(`${BASE_URL}/api/auth/get-session`, { headers: { cookie } }))).json();
        expect(((await session()) as { user: { twoFactorEnabled: boolean } }).user.twoFactorEnabled).toBe(false);
        // A wrong code activates nothing.
        expect((await call(post('/api/auth/two-factor/verify-totp', { code: '000000' }, cookie))).status).toBe(401);
        expect(((await session()) as { user: { twoFactorEnabled: boolean } }).user.twoFactorEnabled).toBe(false);
        // The secret is stored protected, never as the value shown to the user.
        expect(JSON.stringify(memory.records.TwoFactor)).not.toContain(totpSecretFromUri(body.totpURI));

        const enrolled = await enroll(cookie);
        const { secret } = enrolled;
        const verifiedSession = (await (
            await call(new Request(`${BASE_URL}/api/auth/get-session`, { headers: { cookie: enrolled.cookie } }))
        ).json()) as { user: { twoFactorEnabled: boolean; updatedAt: string }; session: { createdAt: string } };
        expect(verifiedSession.user.twoFactorEnabled).toBe(true);
        expect(Date.parse(verifiedSession.session.createdAt)).toBeGreaterThanOrEqual(
            Date.parse(verifiedSession.user.updatedAt),
        );
        const login = await signIn();
        expect(await login.json()).toMatchObject({ twoFactorRedirect: true });
        // No session exists until the second factor is verified.
        const pending = cookies(login);
        expect(
            await (
                await call(new Request(`${BASE_URL}/api/auth/get-session`, { headers: { cookie: pending } }))
            ).json(),
        ).toBeNull();
        const verified = await call(
            post('/api/auth/two-factor/verify-totp', { code: totpCode(secret, totpStep(Date.now())) }, pending),
        );
        expect(verified.status).toBe(200);
        const full = cookies(verified);
        const active = (await (
            await call(new Request(`${BASE_URL}/api/auth/get-session`, { headers: { cookie: full } }))
        ).json()) as { user: { twoFactorEnabled: boolean; updatedAt: string }; session: { createdAt: string } };
        expect(active.user.twoFactorEnabled).toBe(true);
        // The signals admin relies on: the verified session is newer than the enrollment.
        expect(Date.parse(active.session.createdAt)).toBeGreaterThanOrEqual(Date.parse(active.user.updatedAt));
    });

    it('leaves sessions that predate enrollment older than the user’s last update, and replaces the enrolling one', async () => {
        const { call, signUp, signIn, enroll } = await setup();
        const enrolling = await signUp();
        const other = cookies(await signIn());
        const { cookie } = await enroll(enrolling);
        const read = async (value: string) =>
            (await (
                await call(new Request(`${BASE_URL}/api/auth/get-session`, { headers: { cookie: value } }))
            ).json()) as {
                user: { updatedAt: string };
                session: { createdAt: string };
            } | null;
        const stale = await read(other);
        expect(stale).not.toBeNull();
        expect(Date.parse(stale?.session.createdAt ?? '')).toBeLessThan(Date.parse(stale?.user.updatedAt ?? ''));
        const fresh = await read(cookie);
        expect(Date.parse(fresh?.session.createdAt ?? '')).toBeGreaterThanOrEqual(
            Date.parse(fresh?.user.updatedAt ?? ''),
        );
    });

    it('accepts a backup code once and rejects a reused or invalid one', async () => {
        const { call, signIn, signUp, enroll } = await setup();
        const cookie = await signUp();
        const { backupCodes } = await enroll(cookie);
        const first = cookies(await signIn());
        const used = await call(post('/api/auth/two-factor/verify-backup-code', { code: backupCodes[0] }, first));
        expect(used.status).toBe(200);
        const second = cookies(await signIn());
        expect(
            (await call(post('/api/auth/two-factor/verify-backup-code', { code: backupCodes[0] }, second))).status,
        ).toBe(401);
        expect(
            (await call(post('/api/auth/two-factor/verify-backup-code', { code: 'nope-nope' }, second))).status,
        ).toBe(401);
    });

    it('locks the account after the configured number of failures, even for a correct code', async () => {
        const { call, signIn, signUp, enroll } = await setup({ maxFailedAttempts: 3 });
        const cookie = await signUp();
        const { secret } = await enroll(cookie);
        const pending = cookies(await signIn());
        for (let attempt = 0; attempt < 3; attempt += 1) {
            expect(
                (await call(post('/api/auth/two-factor/verify-totp', { code: '000000' }, pending))).status,
            ).toBeGreaterThanOrEqual(400);
        }
        const locked = await call(
            post('/api/auth/two-factor/verify-totp', { code: totpCode(secret, totpStep(Date.now())) }, pending),
        );
        expect(locked.status).toBe(429);
    });

    it('exposes only the sanctioned two-factor endpoints', async () => {
        const { call, signUp } = await setup();
        const cookie = await signUp();
        for (const path of [
            '/api/auth/two-factor/send-otp',
            '/api/auth/two-factor/verify-otp',
            '/api/auth/two-factor/get-totp-uri',
        ]) {
            expect((await call(post(path, {}, cookie))).status).toBe(404);
        }
        expect((await call(post('/api/auth/two-factor/enable', { password: 'wrong-password' }, cookie))).status).toBe(
            400,
        );
    });
});
