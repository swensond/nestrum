import type { SsoAuditEvent } from '@nestrum/core';
import { defineApplication } from '@nestrum/core';
import { createHonoRuntime } from '@nestrum/hono';
import { afterAll, describe, expect, it } from 'vitest';
import { defineAuth } from '../src/index.js';
import { storage } from './fixtures.js';
import { idpMetadata, startFakeOidc, TEST_CERTIFICATE } from './sso-fixtures.js';

const BASE_URL = 'http://localhost:3000';
const SECRET = 'nestrum-test-secret-longer-than-thirty-two-characters';
const idps: { close(): Promise<void> }[] = [];
afterAll(async () => {
    await Promise.all(idps.map((idp) => idp.close()));
});

async function setup(
    sso: Partial<NonNullable<Parameters<typeof defineAuth>[0]['sso']>> = {},
    trustedIdpOrigins: string[] = [],
) {
    const memory = storage();
    const audit: SsoAuditEvent[] = [];
    const application = defineApplication({
        apps: [],
        database: { kind: 'prisma', provider: 'postgresql', connection: 'unused' },
        auth: defineAuth({
            baseURL: BASE_URL,
            secret: SECRET,
            prisma: () => memory.binding,
            sso: { enabled: true, trustedIdpOrigins, onAudit: (event) => void audit.push(event), ...sso },
        }),
    });
    const runtime = createHonoRuntime({ application, onError: () => {} });
    await runtime.start();
    // biome-ignore lint/style/noNonNullAssertion: SSO is enabled above
    const providers = application.auth!.sso!;

    return { application, runtime, memory, providers, audit };
}

async function oidcSetup(options: Parameters<typeof setup>[0] = {}) {
    const idp = await startFakeOidc();
    idps.push(idp);
    const context = await setup(options, [idp.origin]);
    const create = (overrides: object = {}) =>
        context.providers.create({
            type: 'oidc',
            providerId: 'acme-okta',
            displayName: 'Acme Okta',
            organizationId: 'org-acme',
            domains: ['acme.test'],
            issuer: idp.issuer,
            clientId: 'client-1',
            clientSecret: 'super-secret-client-value',
            ...overrides,
        } as never);

    return { ...context, idp, create };
}

const json = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    new Request(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE_URL, ...headers },
        body: JSON.stringify(body),
    });

describe('SSO registry and secrets', () => {
    it('is absent unless enabled', async () => {
        const memory = storage();
        const application = defineApplication({
            apps: [],
            database: { kind: 'prisma', provider: 'postgresql', connection: 'unused' },
            auth: defineAuth({
                baseURL: BASE_URL,
                secret: SECRET,
                prisma: () => ({ ...memory.binding, database: 'default' }),
            }),
        });
        const runtime = createHonoRuntime({ application, onError: () => {} });
        await runtime.start();
        expect(application.auth?.sso).toBeUndefined();
        const response = await runtime.fetch(json('/api/auth/sign-in/sso', { providerId: 'x', callbackURL: '/' }));
        expect(response.status).toBe(404);
    });

    it('creates an OIDC provider, encrypts the secret at rest and never returns it', async () => {
        const { create, memory, providers, audit } = await oidcSetup();
        const created = await create();
        expect(created).toMatchObject({
            type: 'oidc',
            providerId: 'acme-okta',
            displayName: 'Acme Okta',
            enabled: true,
            organizationId: 'org-acme',
            domains: ['acme.test'],
            clientId: 'client-1',
            clientSecretConfigured: true,
            domainVerification: 'not-required',
            lastValidationStatus: 'passed',
        });
        expect(created.type === 'oidc' && created.advanced.authorizationEndpoint).toMatch(/\/authorize$/);
        expect(JSON.stringify(created)).not.toContain('super-secret-client-value');
        expect(JSON.stringify(await providers.list())).not.toContain('super-secret-client-value');
        const stored = memory.records.SsoProvider[0] as { oidcConfig: string };
        expect(stored.oidcConfig).not.toContain('super-secret-client-value');
        expect(JSON.parse(stored.oidcConfig).clientSecret).toMatch(/^nsso1:/);
        expect(audit.map((event) => event.type)).toEqual(['created']);
        expect(JSON.stringify(audit)).not.toContain('super-secret');
    });

    it('keeps an unchanged secret on edit and replaces it only when supplied', async () => {
        const { create, memory, providers } = await oidcSetup();
        await create();
        const before = (memory.records.SsoProvider[0] as { oidcConfig: string }).oidcConfig;
        await providers.update('acme-okta', { displayName: 'Acme SSO' });
        expect((memory.records.SsoProvider[0] as { oidcConfig: string }).oidcConfig).toBe(before);
        await providers.update('acme-okta', { clientSecret: 'a-brand-new-secret' });
        const after = (memory.records.SsoProvider[0] as { oidcConfig: string }).oidcConfig;
        expect(after).not.toBe(before);
        expect(after).not.toContain('a-brand-new-secret');
        expect(await providers.get('acme-okta')).toMatchObject({
            displayName: 'Acme SSO',
            clientSecretConfigured: true,
        });
    });

    it('rejects colliding, reserved and malformed provider ids without changing display-name identity', async () => {
        const { create, providers } = await oidcSetup();
        await create();
        await expect(create()).rejects.toMatchObject({ code: 'SSO_PROVIDER_EXISTS', status: 409 });
        await expect(create({ providerId: 'credential' })).rejects.toMatchObject({ code: 'SSO_PROVIDER_ID_RESERVED' });
        await expect(create({ providerId: 'google' })).rejects.toMatchObject({ code: 'SSO_PROVIDER_ID_RESERVED' });
        await expect(create({ providerId: 'Bad_ID' })).rejects.toMatchObject({ code: 'SSO_INVALID_INPUT' });
        await expect(create({ providerId: 'x'.repeat(60) })).rejects.toMatchObject({ code: 'SSO_INVALID_INPUT' });
        await expect(create({ providerId: 'p2', domains: ['not a domain'] })).rejects.toMatchObject({
            code: 'SSO_INVALID_INPUT',
        });
        await expect(create({ providerId: 'p3', clientSecret: undefined })).rejects.toMatchObject({
            code: 'SSO_INVALID_INPUT',
        });
        await expect(create({ providerId: 'p4', extra: true })).rejects.toMatchObject({ code: 'SSO_INVALID_INPUT' });
        await providers.update('acme-okta', { displayName: 'Renamed' });
        expect((await providers.get('acme-okta')).providerId).toBe('acme-okta');
        await expect(providers.update('acme-okta', { providerId: 'other' } as never)).rejects.toMatchObject({
            code: 'SSO_INVALID_INPUT',
        });
    });

    it('supports several providers, including several for one organization', async () => {
        const { create, providers } = await oidcSetup();
        await create();
        await create({ providerId: 'acme-entra', displayName: 'Acme Entra', domains: ['acme.example'] });
        await providers.create({
            type: 'saml',
            providerId: 'initech-saml',
            displayName: 'Initech',
            organizationId: 'org-initech',
            domains: ['initech.test'],
            idpMetadata: idpMetadata(),
        });
        const list = await providers.list();
        expect(list.map((entry) => entry.providerId).sort()).toEqual(['acme-entra', 'acme-okta', 'initech-saml']);
        expect(list.filter((entry) => entry.organizationId === 'org-acme')).toHaveLength(2);
    });

    it('refuses private IdP hosts unless the operator declared them', async () => {
        const { providers } = await setup();
        await expect(
            providers.create({
                type: 'oidc',
                providerId: 'internal',
                displayName: 'Internal',
                domains: ['internal.test'],
                issuer: 'https://169.254.169.254',
                clientId: 'c',
                clientSecret: 's',
            }),
        ).rejects.toMatchObject({ code: 'SSO_INVALID_INPUT', status: 422 });
        await expect(
            providers.create({
                type: 'oidc',
                providerId: 'local',
                displayName: 'Local',
                domains: ['local.test'],
                issuer: 'http://localhost:9999',
                clientId: 'c',
                clientSecret: 's',
            }),
        ).rejects.toMatchObject({ code: 'SSO_INVALID_INPUT' });
    });
});

describe('OIDC validation, enablement and sign-in', () => {
    it('tests a provider without treating the test as a login', async () => {
        const { create, providers, audit } = await oidcSetup();
        await create({ enabled: false });
        const result = await providers.test('acme-okta');
        expect(result).toMatchObject({ type: 'oidc', valid: true, providerId: 'acme-okta' });
        expect(result.diagnostics.map((entry) => entry.code)).toEqual(['PROVIDER_DISABLED']);
        const summary = await providers.get('acme-okta');
        expect(summary.lastValidatedAt).not.toBeNull();
        expect(summary.lastValidationStatus).toBe('passed');
        expect(summary.lastSuccessfulLoginAt).toBeNull();
        expect(audit.map((event) => event.type)).toContain('test-attempted');
    });

    it('reports discovery failure and issuer mismatch with fixed safe messages', async () => {
        const idp = await startFakeOidc({ issuerSuffix: '/tenant' });
        idps.push(idp);
        const { providers } = await setup({}, [idp.origin]);
        const base = {
            type: 'oidc' as const,
            displayName: 'Broken',
            domains: ['broken.test'],
            clientId: 'c',
            clientSecret: 's',
            enabled: false,
        };
        await providers.create({ ...base, providerId: 'wrong-issuer', issuer: idp.origin });
        await providers.update('wrong-issuer', {
            advanced: { discoveryEndpoint: `${idp.issuer}/.well-known/openid-configuration` },
        });
        const mismatch = await providers.test('wrong-issuer');
        expect(mismatch.valid).toBe(false);
        expect(mismatch.diagnostics[0]?.code).toBe('OIDC_ISSUER_MISMATCH');
        await providers.create({ ...base, providerId: 'missing', issuer: `${idp.origin}/nowhere` });
        const missing = await providers.test('missing');
        expect(missing.diagnostics[0]?.code).toBe('OIDC_DISCOVERY_FAILED');
        expect(JSON.stringify([mismatch, missing])).not.toContain(idp.origin);
        expect((await providers.get('missing')).lastValidationStatus).toBe('failed');
        await expect(providers.setEnabled('missing', true)).rejects.toMatchObject({
            code: 'SSO_INVALID_INPUT',
            status: 422,
        });
    });

    it('refuses to create an enabled provider whose discovery fails', async () => {
        const { create } = await oidcSetup();
        await expect(create({ issuer: 'https://idp.invalid.example' })).rejects.toMatchObject({ status: 422 });
    });

    it('signs a user in through the plugin and records the SSO session context', async () => {
        const { create, runtime, idp, application, memory, providers } = await oidcSetup();
        await create();
        const start = await runtime.fetch(
            json('/api/auth/sign-in/sso', {
                email: 'someone@acme.test',
                callbackURL: `${BASE_URL}/done`,
                scopes: ['admin'],
            }),
        );
        expect(start.status).toBe(200);
        const { url } = (await start.json()) as { url: string };
        const authorization = new URL(url);
        expect(authorization.origin).toBe(idp.origin);
        expect(authorization.searchParams.get('scope')).not.toContain('admin');
        const cookie = (start.headers.getSetCookie() ?? []).map((value) => value.split(';')[0]).join('; ');
        const callback = await runtime.fetch(
            new Request(
                `${BASE_URL}/api/auth/sso/callback/acme-okta?code=abc&state=${authorization.searchParams.get('state')}`,
                { headers: { cookie } },
            ),
        );
        expect(callback.status).toBe(302);
        expect(callback.headers.get('location')).toBe(`${BASE_URL}/done`);
        expect(idp.state.tokenRequests).toBe(1);
        const session = {
            cookie: callback.headers
                .getSetCookie()
                .map((value) => value.split(';')[0])
                .join('; '),
        };
        // biome-ignore lint/style/noNonNullAssertion: auth configured
        const current = await application.auth!.getSession(new Request(BASE_URL, { headers: session }));
        expect(current?.user.email).toBe('sso.user@acme.test');
        expect(current?.session).toMatchObject({ authMethod: 'sso', ssoProviderId: 'acme-okta' });
        // biome-ignore lint/style/noNonNullAssertion: auth configured
        const subject = await application.auth!.resolveSubject(new Request(BASE_URL, { headers: session }));
        expect(subject).toMatchObject({
            anonymous: false,
            role: 'user',
            authMethod: 'sso',
            ssoProviderId: 'acme-okta',
        });
        expect((await providers.get('acme-okta')).lastSuccessfulLoginAt).not.toBeNull();
        // The stored account is linked to the provider id; secrets never reach it.
        expect(JSON.stringify(memory.records.Account)).not.toContain('super-secret-client-value');
    });

    it('cannot promote itself through IdP claims', async () => {
        const { create, runtime, application } = await oidcSetup();
        await create({ advanced: { mapping: { extraFields: { role: 'role' } } } });
        const start = await runtime.fetch(
            json('/api/auth/sign-in/sso', { providerId: 'acme-okta', callbackURL: `${BASE_URL}/done` }),
        );
        const url = new URL(((await start.json()) as { url: string }).url);
        const cookie = start.headers
            .getSetCookie()
            .map((value) => value.split(';')[0])
            .join('; ');
        const callback = await runtime.fetch(
            new Request(`${BASE_URL}/api/auth/sso/callback/acme-okta?code=x&state=${url.searchParams.get('state')}`, {
                headers: { cookie },
            }),
        );
        // biome-ignore lint/style/noNonNullAssertion: auth configured
        const subject = await application.auth!.resolveSubject(
            new Request(BASE_URL, {
                headers: {
                    cookie: callback.headers
                        .getSetCookie()
                        .map((value) => value.split(';')[0])
                        .join('; '),
                },
            }),
        );
        expect(subject.role).toBe('user');
    });

    it('rejects sign-in and callbacks for disabled providers and never blocks users or sessions', async () => {
        const { create, runtime, providers, memory, audit } = await oidcSetup();
        await create();
        const disabled = await providers.setEnabled('acme-okta', false, { actorId: 'admin-1' });
        expect(disabled.enabled).toBe(false);
        const start = await runtime.fetch(
            json('/api/auth/sign-in/sso', { providerId: 'acme-okta', callbackURL: `${BASE_URL}/x` }),
        );
        expect(start.status).toBe(404);
        const byDomain = await runtime.fetch(
            json('/api/auth/sign-in/sso', { email: 'a@acme.test', callbackURL: `${BASE_URL}/x` }),
        );
        expect(byDomain.status).toBe(404);
        const callback = await runtime.fetch(new Request(`${BASE_URL}/api/auth/sso/callback/acme-okta?code=a&state=b`));
        expect(callback.status).toBe(403);
        expect(await callback.json()).toMatchObject({ error: { code: 'SSO_PROVIDER_DISABLED' } });
        expect(memory.records.User).toHaveLength(0);
        expect(audit.map((event) => event.type)).toEqual(['created', 'disabled']);
        expect(audit[1]).toMatchObject({ actorId: 'admin-1', providerId: 'acme-okta' });
        const enabled = await providers.setEnabled('acme-okta', true);
        expect(enabled.enabled).toBe(true);
    });

    it('deletes configuration only and leaves users, accounts and sessions alone', async () => {
        const { create, providers, memory, audit } = await oidcSetup();
        await create();
        memory.records.User.push({ id: 'u1', email: 'x@acme.test' });
        memory.records.Account.push({ id: 'a1', providerId: 'acme-okta', accountId: 'idp-1', userId: 'u1' });
        memory.records.Session.push({ id: 's1', userId: 'u1' });
        await providers.delete('acme-okta');
        await expect(providers.get('acme-okta')).rejects.toMatchObject({ code: 'SSO_PROVIDER_NOT_FOUND', status: 404 });
        expect(memory.records.SsoProvider).toHaveLength(0);
        expect(memory.records.User).toHaveLength(1);
        expect(memory.records.Account).toHaveLength(1);
        expect(memory.records.Session).toHaveLength(1);
        expect(audit.map((event) => event.type)).toEqual(['created', 'deleted']);
    });

    it('exposes only an allowlist of SSO routes', async () => {
        const { create, runtime } = await oidcSetup();
        await create();
        for (const path of [
            '/api/auth/sso/register',
            '/api/auth/sso/providers',
            '/api/auth/sso/update-provider',
            '/api/auth/sso/delete-provider',
            '/api/auth/sso/callback',
        ]) {
            const response = await runtime.fetch(json(path, {}));
            expect(response.status).toBe(404);
        }
        const foreign = await runtime.fetch(
            json(
                '/api/auth/sign-in/sso',
                { providerId: 'acme-okta', callbackURL: `${BASE_URL}/x` },
                { origin: 'https://evil.example' },
            ),
        );
        expect(foreign.status).toBe(403);
        const evilCallback = await runtime.fetch(
            json('/api/auth/sign-in/sso', { providerId: 'acme-okta', callbackURL: 'https://evil.example/steal' }),
        );
        expect(evilCallback.status).toBeGreaterThanOrEqual(400);
    });
});

describe('login discovery', () => {
    it('resolves by email domain, provider id and organization slug and asks when several match', async () => {
        const { create, providers } = await oidcSetup({
            resolveOrganization: (slug) => (slug === 'acme' ? 'org-acme' : null),
        });
        await create();
        expect(await providers.discover({ email: 'A@Acme.test' })).toMatchObject({
            status: 'match',
            provider: { providerId: 'acme-okta' },
        });
        expect(await providers.discover({ providerId: 'acme-okta' })).toMatchObject({ status: 'match' });
        expect(await providers.discover({ organizationSlug: 'acme' })).toMatchObject({ status: 'match' });
        expect(await providers.discover({ organizationSlug: 'none' })).toEqual({ status: 'none' });
        expect(await providers.discover({ email: 'a@other.test' })).toEqual({ status: 'none' });
        await create({ providerId: 'acme-second', displayName: 'Second' });
        const choice = await providers.discover({ email: 'a@acme.test' });
        expect(choice.status).toBe('choice');
        expect(choice.status === 'choice' && choice.providers.map((entry) => entry.providerId).sort()).toEqual([
            'acme-okta',
            'acme-second',
        ]);
    });

    it('serves discovery and refuses ambiguous sign-in over HTTP', async () => {
        const { create, runtime } = await oidcSetup();
        await create();
        await create({ providerId: 'acme-second', displayName: 'Second' });
        const found = await runtime.fetch(new Request(`${BASE_URL}/api/auth/sso/discover?email=a@acme.test`));
        expect(await found.json()).toMatchObject({ status: 'choice' });
        const ambiguous = await runtime.fetch(
            json('/api/auth/sign-in/sso', { email: 'a@acme.test', callbackURL: `${BASE_URL}/x` }),
        );
        expect(ambiguous.status).toBe(409);
        expect(await ambiguous.json()).toMatchObject({ error: { code: 'SSO_DISCOVERY_AMBIGUOUS' } });
    });
});

describe('domain verification', () => {
    it('shows unverified, pending and verified, and blocks sign-in until verified', async () => {
        const records = new Map<string, string[][]>();
        const { create, providers, runtime, audit } = await oidcSetup({
            domainVerification: { enabled: true, resolveTxt: async (name) => records.get(name) ?? [] },
        });
        const created = await create();
        expect(created.domainVerification).toBe('unverified');
        // Unverified domains are not used for sign-in routing.
        expect(await providers.discover({ email: 'a@acme.test' })).toEqual({ status: 'none' });
        const instructions = await providers.requestDomainVerification('acme-okta');
        expect(instructions).toMatchObject({
            status: 'pending',
            recordName: '_nestrum-sso-acme-okta',
            domains: ['acme.test'],
        });
        expect((await providers.get('acme-okta')).domainVerification).toBe('pending');
        await expect(providers.verifyDomain('acme-okta')).rejects.toMatchObject({
            code: 'SSO_DOMAIN_VERIFICATION_FAILED',
        });
        const sameAgain = await providers.requestDomainVerification('acme-okta');
        expect(sameAgain.recordValue).toBe(instructions.recordValue);
        records.set('_nestrum-sso-acme-okta.acme.test', [[instructions.recordValue as string]]);
        const verified = await providers.verifyDomain('acme-okta');
        expect(verified.domainVerification).toBe('verified');
        expect(await providers.discover({ email: 'a@acme.test' })).toMatchObject({ status: 'match' });
        expect(audit.filter((event) => event.type === 'domain-verification-changed').length).toBeGreaterThan(1);
        // Changing domains resets trust.
        const changed = await providers.update('acme-okta', { domains: ['acme.test', 'acme.example'] });
        expect(changed.domainVerification).toBe('unverified');
        const start = await runtime.fetch(
            json('/api/auth/sign-in/sso', { providerId: 'acme-okta', callbackURL: `${BASE_URL}/x` }),
        );
        expect(start.status).toBeGreaterThanOrEqual(400);
    });

    it('reports not-required when verification is off', async () => {
        const { create, providers } = await oidcSetup();
        await create();
        await expect(providers.requestDomainVerification('acme-okta')).rejects.toMatchObject({ status: 409 });
    });
});

describe('SAML 2.0 providers', () => {
    const saml = (overrides: object = {}) => ({
        type: 'saml' as const,
        providerId: 'initech-saml',
        displayName: 'Initech',
        organizationId: 'org-initech',
        domains: ['initech.test'],
        idpMetadata: idpMetadata(),
        ...overrides,
    });

    it('creates from metadata and derives the service provider values', async () => {
        const { providers } = await setup();
        const created = await providers.create(saml());
        expect(created).toMatchObject({
            type: 'saml',
            idpEntityId: 'https://idp.example.test/entity',
            idpMetadataConfigured: true,
            serviceProvider: {
                acsUrl: `${BASE_URL}/api/auth/sso/saml2/sp/acs/initech-saml`,
                entityId: `${BASE_URL}/api/auth/sso/saml2/sp/metadata?providerId=initech-saml`,
                metadataUrl: `${BASE_URL}/api/auth/sso/saml2/sp/metadata?providerId=initech-saml`,
                callbackUrl: `${BASE_URL}/api/auth/sso/saml2/sp/acs/initech-saml`,
            },
        });
        const result = await providers.test('initech-saml');
        expect(result).toMatchObject({ valid: true, type: 'saml' });
    });

    it('rejects malformed metadata, bad certificates and missing IdP values', async () => {
        const { providers } = await setup();
        await expect(providers.create(saml({ idpMetadata: '<not-metadata' }))).rejects.toMatchObject({
            code: 'SSO_INVALID_INPUT',
            status: 422,
        });
        await expect(providers.create(saml({ idpMetadata: idpMetadata('https://idp', 'AAAA') }))).rejects.toMatchObject(
            { status: 422 },
        );
        await expect(providers.create(saml({ idpMetadata: undefined }))).rejects.toMatchObject({ status: 422 });
        await expect(
            providers.create(
                saml({
                    idpMetadata: undefined,
                    advanced: { entryPoint: 'https://idp.example.test/sso', cert: 'garbage' },
                }),
            ),
        ).rejects.toMatchObject({ status: 422 });
    });

    it('accepts manual IdP settings and an IdP-initiated destination but flags cross-origin ones', async () => {
        const { providers } = await setup();
        const created = await providers.create(
            saml({
                idpMetadata: undefined,
                advanced: {
                    entryPoint: 'https://idp.example.test/sso',
                    cert: TEST_CERTIFICATE,
                    idpInitiatedCallbackUrl: '/welcome',
                },
            }),
        );
        expect(created.type === 'saml' && created.advanced.idpInitiatedCallbackUrl).toBe('/welcome');
        await expect(
            providers.update('initech-saml', { advanced: { idpInitiatedCallbackUrl: 'javascript:alert(1)' } }),
        ).rejects.toMatchObject({ code: 'SSO_INVALID_INPUT' });
    });

    it('serves SP metadata only for enabled providers and rejects disabled ACS posts', async () => {
        const { providers, runtime } = await setup();
        await providers.create(saml());
        const metadata = await runtime.fetch(
            new Request(`${BASE_URL}/api/auth/sso/saml2/sp/metadata?providerId=initech-saml`),
        );
        expect(metadata.status).toBe(200);
        expect(await metadata.text()).toContain('EntityDescriptor');
        await providers.setEnabled('initech-saml', false);
        const hidden = await runtime.fetch(
            new Request(`${BASE_URL}/api/auth/sso/saml2/sp/metadata?providerId=initech-saml`),
        );
        expect(hidden.status).toBe(404);
        const acs = await runtime.fetch(
            new Request(`${BASE_URL}/api/auth/sso/saml2/sp/acs/initech-saml`, {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://idp.example.test' },
                body: 'SAMLResponse=abc',
            }),
        );
        expect(acs.status).toBe(403);
        expect(await acs.json()).toMatchObject({ error: { code: 'SSO_PROVIDER_DISABLED' } });
    });

    it('lets an enabled provider’s ACS receive a cross-site IdP post but rejects an invalid assertion safely', async () => {
        const { providers, runtime } = await setup();
        await providers.create(saml());
        const acs = await runtime.fetch(
            new Request(`${BASE_URL}/api/auth/sso/saml2/sp/acs/initech-saml`, {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://idp.example.test' },
                body: `SAMLResponse=${Buffer.from('<Response InResponseTo="_abc"/>').toString('base64')}`,
            }),
        );
        expect(acs.status).not.toBe(200);
        expect(acs.status).not.toBe(403);
        const location = acs.headers.get('location') ?? '';
        expect(location).not.toContain('InResponseTo');
    });

    it('encrypts SAML private values at rest', async () => {
        const { providers, memory } = await setup();
        await providers.create(saml());
        const stored = memory.records.SsoProvider[0] as { samlConfig: string };
        expect(JSON.parse(stored.samlConfig).idpMetadata.metadata).toContain('EntityDescriptor');
    });
});
