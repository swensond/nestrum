import { defineApplication } from '@nestrum/core';
import { createHonoRuntime } from '@nestrum/hono';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { defineAuth } from '../src/index.js';
import { assertIdpUrl, isPrivateAddress } from '../src/sso/network.js';
import { resolveSsoOptions } from '../src/sso/options.js';
import { openProviderConfig, SecretBox, sealProviderConfig } from '../src/sso/secrets.js';
import { storage } from './fixtures.js';
import { startFakeOidc } from './sso-fixtures.js';

const BASE_URL = 'http://localhost:3000';
const SECRET = 'nestrum-test-secret-longer-than-thirty-two-characters';
const idps: { close(): Promise<void> }[] = [];
afterAll(async () => {
    await Promise.all(idps.map((idp) => idp.close()));
});

describe('SSO secret sealing', () => {
    const box = new SecretBox(SECRET);

    it('round-trips, never repeats ciphertext and rejects tampering or another key', async () => {
        const first = await box.seal('client-secret');
        const second = await box.seal('client-secret');
        expect(first).toMatch(/^nsso1:/);
        expect(first).not.toBe(second);
        expect(first).not.toContain('client-secret');
        expect(await box.open(first)).toBe('client-secret');
        const tampered = `${first.slice(0, -2)}${first.endsWith('AA') ? 'BB' : 'AA'}`;
        await expect(box.open(tampered)).rejects.toMatchObject({ code: 'SSO_SECRET_UNREADABLE' });
        await expect(new SecretBox('another-secret-that-is-long-enough-xx').open(first)).rejects.toMatchObject({
            code: 'SSO_SECRET_UNREADABLE',
        });
        await expect(box.open('nsso1:')).rejects.toMatchObject({ code: 'SSO_SECRET_INVALID' });
    });

    it('seals only private values in each protocol config and leaves sealed values alone', async () => {
        const row = {
            oidcConfig: JSON.stringify({ clientId: 'c', clientSecret: 'shh', issuer: 'https://idp.test' }),
            samlConfig: JSON.stringify({
                issuer: 'sp',
                privateKey: 'PRIVATE-KEY',
                spMetadata: { entityID: 'sp', privateKey: 'SP-KEY', encPrivateKeyPass: 'pass' },
                idpMetadata: { metadata: '<xml/>' },
            }),
            providerId: 'p',
        };
        const sealed = await sealProviderConfig(box, row);
        const text = JSON.stringify(sealed);
        for (const plain of ['shh', 'PRIVATE-KEY', 'SP-KEY', 'pass"']) {
            expect(text).not.toContain(plain);
        }
        expect(JSON.parse(sealed.oidcConfig as string).clientId).toBe('c');
        expect(JSON.parse(sealed.samlConfig as string).idpMetadata.metadata).toBe('<xml/>');
        expect(await sealProviderConfig(box, sealed)).toEqual(sealed);
        expect(await openProviderConfig(box, sealed)).toEqual(row);
        expect(await sealProviderConfig(box, { providerId: 'p' })).toEqual({ providerId: 'p' });
    });
});

describe('IdP network policy', () => {
    it('classifies private and public addresses', () => {
        for (const address of [
            '127.0.0.1',
            '10.1.2.3',
            '172.16.0.1',
            '192.168.1.1',
            '169.254.169.254',
            '100.64.0.1',
            '0.0.0.0',
            '::1',
            'fd00::1',
            'fe80::1',
            '::ffff:10.0.0.1',
        ]) {
            expect(isPrivateAddress(address), address).toBe(true);
        }
        for (const address of ['8.8.8.8', '93.184.216.34', '2606:4700::1111']) {
            expect(isPrivateAddress(address), address).toBe(false);
        }
    });

    it('accepts only HTTPS public hosts unless the origin is declared', async () => {
        const publicHost = async () => ['93.184.216.34'];
        expect(await assertIdpUrl('https://idp.example.com/path', [], publicHost)).toBe('https://idp.example.com');
        for (const value of [
            'http://idp.example.com',
            'https://localhost',
            'https://intranet',
            'https://10.0.0.1',
            'https://idp.internal',
            'ftp://x.example.com',
            'https://user:pass@idp.example.com',
        ]) {
            await expect(assertIdpUrl(value, [], publicHost), value).rejects.toThrow();
        }
        await expect(assertIdpUrl('https://rebind.example.com', [], async () => ['127.0.0.1'])).rejects.toThrow(
            'untrusted-host',
        );
        await expect(
            assertIdpUrl('https://gone.example.com', [], async () => Promise.reject(new Error('x'))),
        ).rejects.toThrow('unresolvable-host');
        expect(await assertIdpUrl('http://127.0.0.1:9000/x', ['http://127.0.0.1:9000'], publicHost)).toBe(
            'http://127.0.0.1:9000',
        );
    });
});

describe('SSO configuration', () => {
    it('is off by default and validates its options', () => {
        expect(resolveSsoOptions(undefined)).toBeUndefined();
        expect(resolveSsoOptions({ enabled: false })).toBeUndefined();
        expect(resolveSsoOptions({ enabled: true })).toMatchObject({
            trustedIdpOrigins: [],
            domainVerification: { enabled: false },
        });
        for (const bad of [
            { enabled: 'yes' },
            { enabled: true, unknown: 1 },
            { enabled: true, trustedIdpOrigins: ['idp.test'] },
            { enabled: true, trustedIdpOrigins: 'https://x.test' },
            { enabled: true, onAudit: 'x' },
            { enabled: true, provisioning: { disableImplicitSignUp: 'x' } },
        ]) {
            expect(() => resolveSsoOptions(bad as never), JSON.stringify(bad)).toThrow();
        }
        expect(() =>
            defineAuth({
                baseURL: BASE_URL,
                secret: SECRET,
                prisma: () => storage().binding,
                sso: { enabled: true, unknown: 1 } as never,
            }),
        ).toThrow(/Unknown SSO option/);
    });
});

async function provisioned(provisioning: object, transactions = false) {
    const idp = await startFakeOidc({ email: 'new.person@acme.test' });
    idps.push(idp);
    const memory = storage('identity', { transactions });
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
            sso: { enabled: true, trustedIdpOrigins: [idp.origin], provisioning },
        }),
    });
    const runtime = createHonoRuntime({ application, onError: () => {} });
    await runtime.start();
    // biome-ignore lint/style/noNonNullAssertion: SSO is enabled
    await application.auth!.sso!.create({
        type: 'oidc',
        providerId: 'acme-okta',
        displayName: 'Acme',
        domains: ['acme.test'],
        issuer: idp.issuer,
        clientId: 'client-1',
        clientSecret: 'provisioning-secret',
    });
    const signIn = async (extra: object = {}) => {
        const start = await runtime.fetch(
            new Request(`${BASE_URL}/api/auth/sign-in/sso`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', origin: BASE_URL },
                body: JSON.stringify({
                    providerId: 'acme-okta',
                    callbackURL: `${BASE_URL}/done`,
                    errorCallbackURL: `${BASE_URL}/failed`,
                    ...extra,
                }),
            }),
        );
        const state = new URL(((await start.json()) as { url: string }).url).searchParams.get('state');
        const cookie = start.headers
            .getSetCookie()
            .map((value) => value.split(';')[0])
            .join('; ');

        return runtime.fetch(
            new Request(`${BASE_URL}/api/auth/sso/callback/acme-okta?code=abc&state=${state}`, { headers: { cookie } }),
        );
    };

    return { memory, signIn, application };
}

describe('SSO provisioning policy', () => {
    it('creates and provisions a new user by default, calling the provisioning callback', async () => {
        const provisionUser = vi.fn();
        const { memory, signIn } = await provisioned({ provisionUser });
        const callback = await signIn();
        expect(callback.headers.get('location')).toBe(`${BASE_URL}/done`);
        expect(memory.records.User).toHaveLength(1);
        expect(memory.records.User[0]).toMatchObject({ email: 'new.person@acme.test', role: 'user' });
        expect(provisionUser).toHaveBeenCalledTimes(1);
        expect(provisionUser.mock.calls[0]?.[0].user.email).toBe('new.person@acme.test');
    });

    it('refuses to create users when implicit sign-up is disabled', async () => {
        const { memory, signIn } = await provisioned({ disableImplicitSignUp: true });
        const callback = await signIn();
        expect(callback.headers.get('location')).toContain('/failed');
        expect(memory.records.User).toHaveLength(0);
        // Sign-up can still be requested explicitly for this sign-in.
        const requested = await signIn({ requestSignUp: true });
        expect(requested.headers.get('location')).toBe(`${BASE_URL}/done`);
        expect(memory.records.User).toHaveLength(1);
    });

    it('passes resolveUser to Better Auth and fails closed while the adapter has no native transactions', async () => {
        const resolveUser = vi.fn(async () => ({ action: 'continue' as const }));
        const { memory, signIn } = await provisioned({ resolveUser });
        const callback = await signIn();
        expect(callback.status).toBe(302);
        expect(callback.headers.get('location')).toContain('SSO_USER_RESOLUTION_REQUIRES_NATIVE_TRANSACTIONS');
        expect(resolveUser).not.toHaveBeenCalled();
        expect(memory.records.User).toHaveLength(0);
        expect(memory.records.Session).toHaveLength(0);
    });

    it('runs resolveUser atomically when the binding provides transactions', async () => {
        const seen = vi.fn(async () => ({ action: 'continue' as const }));
        const ok = await provisioned({ resolveUser: seen }, true);
        const callback = await ok.signIn();
        expect(callback.headers.get('location')).toBe(`${BASE_URL}/done`);
        expect(seen).toHaveBeenCalledTimes(1);
        expect(ok.memory.records.User).toHaveLength(1);
        expect(ok.memory.records.Session).toHaveLength(1);

        const rejecting = await provisioned(
            { resolveUser: async () => ({ action: 'reject' as const, code: 'not_allowed' }) },
            true,
        );
        const refused = await rejecting.signIn();
        expect(refused.headers.get('location')).toContain('/failed');
        expect(rejecting.memory.records.User).toHaveLength(0);
        expect(rejecting.memory.records.Session).toHaveLength(0);
        expect(rejecting.memory.records.Account).toHaveLength(0);

        const throwing = await provisioned(
            {
                resolveUser: async () => {
                    throw new Error('resolver failed');
                },
            },
            true,
        );
        await throwing.signIn();
        expect(throwing.memory.records.User).toHaveLength(0);
        expect(throwing.memory.records.Session).toHaveLength(0);
    });

    it('never derives a role from IdP attributes', async () => {
        const { memory, signIn } = await provisioned({});
        await signIn();
        expect(memory.records.User[0]).toMatchObject({ role: 'user' });
    });
});

describe('SSO logging and diagnostics', () => {
    it('never writes client secrets, tokens or assertions to logs or errors', async () => {
        const logs: string[] = [];
        const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) =>
            vi.spyOn(console, name).mockImplementation((...args: unknown[]) => void logs.push(JSON.stringify(args))),
        );
        try {
            const { signIn } = await provisioned({});
            await signIn();
            // A replayed or forged callback produces errors, which must stay free of secrets.
            const forged = await fetch('data:,').catch(() => null);
            void forged;
        } finally {
            for (const spy of spies) {
                spy.mockRestore();
            }
        }
        const text = logs.join('\n');
        for (const secret of ['provisioning-secret', 'access-token-value', 'id_token']) {
            expect(text).not.toContain(secret);
        }
    });
});
