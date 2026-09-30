import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import { isAuthPath, safeReturnTo } from '../src/lib/return-to.js';
import {
    createProvider,
    deleteProvider,
    loadSsoDetail,
    loadSsoList,
    loadSsoNew,
    requestVerification,
    SsoAdminClient,
    testProvider,
    toggleProvider,
    updateProvider,
    verifyDomain,
} from '../src/lib/sso.server.js';
import { load as loadLayout } from '../src/routes/+layout.server.js';
import ListPage from '../src/routes/auth/sso/+page.svelte';
import DetailPage from '../src/routes/auth/sso/[providerId]/+page.svelte';
import NewPage from '../src/routes/auth/sso/new/+page.svelte';
import { resource } from './fixtures.js';
import ShellFixture from './ShellFixture.svelte';

const BASE = {
    id: 'p1',
    providerId: 'acme-okta',
    displayName: 'Acme Okta',
    enabled: true,
    organizationId: 'org-acme',
    domains: ['acme.test'],
    domainVerification: 'not-required',
    lastValidatedAt: '2026-01-01T00:00:00.000Z',
    lastValidationStatus: 'passed',
    lastSuccessfulLoginAt: null,
};
const OIDC = {
    ...BASE,
    type: 'oidc',
    issuer: 'https://idp.acme.test',
    clientId: 'client-1',
    clientSecretConfigured: true,
    redirectUri: 'http://localhost:3000/api/auth/sso/callback/acme-okta',
    advanced: { pkce: true },
};
const SAML = {
    ...BASE,
    providerId: 'initech-saml',
    displayName: 'Initech',
    type: 'saml',
    idpEntityId: 'https://idp.initech.test',
    idpMetadataConfigured: true,
    serviceProvider: {
        acsUrl: 'http://localhost:3000/api/auth/sso/saml2/sp/acs/initech-saml',
        entityId: 'http://localhost:3000/api/auth/sso/saml2/sp/metadata?providerId=initech-saml',
        metadataUrl: 'http://localhost:3000/api/auth/sso/saml2/sp/metadata?providerId=initech-saml',
        callbackUrl: 'http://localhost:3000/api/auth/sso/saml2/sp/acs/initech-saml',
    },
    advanced: {},
};
const ALL = {
    enabled: true,
    read: true,
    create: true,
    update: true,
    delete: true,
    enable: true,
    disable: true,
    test: true,
};
const url = (path: string) => new URL(`http://localhost${path}`);
function form(values: Record<string, string>) {
    const data = new FormData();
    for (const [name, value] of Object.entries(values)) {
        data.append(name, value);
    }

    return new Request('http://localhost/admin/auth/sso', { method: 'POST', body: data });
}
type Result = { status: number; data: { message: string } };

describe('SSO admin client', () => {
    it('requests credentialed, uncached and rejects malformed provider payloads', async () => {
        const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
            Response.json({ providers: [OIDC, SAML] }),
        );
        expect(await new SsoAdminClient(fetch).list()).toHaveLength(2);
        expect(fetch.mock.calls[0]?.[0]).toBe('/__admin/auth/sso');
        expect(fetch.mock.calls[0]?.[1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store' });
        await expect(
            new SsoAdminClient(async () => Response.json({ providers: [{ id: 1 }] })).list(),
        ).rejects.toMatchObject({ status: 502 });
        expect(await new SsoAdminClient(async () => Response.json({}, { status: 403 })).capabilities()).toBeNull();
    });

    it('never echoes response bodies in messages', async () => {
        const client = new SsoAdminClient(async () =>
            Response.json({ error: { code: 'X', message: 'super-secret-detail' } }, { status: 422 }),
        );
        const failure = await client.create({}).catch((error: Error) => error);
        expect((failure as Error).message).not.toContain('super-secret-detail');
        expect((failure as Error).message).toMatch(/did not validate/);
    });
});

describe('SSO page data', () => {
    it('shows the layout link only when the API grants read', async () => {
        const event = (read: boolean) =>
            ({
                fetch: vi.fn(async (input: string | URL | Request) =>
                    String(input).endsWith('/auth/sso/capabilities')
                        ? Response.json({ ...ALL, read })
                        : Response.json(
                              String(input).endsWith('/access/capabilities') ? { users: false } : [resource()],
                          ),
                ),
                depends: vi.fn(),
                url: url('/admin'),
            }) as never;
        expect((await loadLayout(event(true))).canManageSso).toBe(true);
        expect((await loadLayout(event(false))).canManageSso).toBe(false);
    });

    it('explains SSO being off or denied without a table', async () => {
        const off = await loadSsoList(async () => Response.json({ ...ALL, enabled: false }));
        expect(off.providers).toBeNull();
        expect(off.message).toMatch(/not enabled/);
        const denied = await loadSsoList(async () => Response.json({ ...ALL, read: false }));
        expect(denied.message).toMatch(/permission/);
        const ok = await loadSsoList(async (input) =>
            Response.json(String(input).endsWith('capabilities') ? ALL : { providers: [OIDC] }),
        );
        expect(ok.message).toBe('');
        expect(ok.providers).toHaveLength(1);
        const detail = await loadSsoDetail(
            async (input) => Response.json(String(input).endsWith('capabilities') ? ALL : { provider: SAML }),
            'initech-saml',
        );
        expect(detail.provider?.type).toBe('saml');
        expect((await loadSsoNew(async () => Response.json(ALL), url('/admin/auth/sso/new?type=saml'))).type).toBe(
            'saml',
        );
        expect((await loadSsoNew(async () => Response.json(ALL), url('/admin/auth/sso/new?type=x'))).type).toBe('oidc');
    });

    it('treats SSO management as an ordinary page, not a challenge page', () => {
        expect(isAuthPath('/admin/auth/sso')).toBe(false);
        expect(isAuthPath('/admin/auth/sso/acme-okta')).toBe(false);
        expect(isAuthPath('/admin/auth/2fa')).toBe(true);
        expect(safeReturnTo('/admin/auth/sso/new')).toBe('/admin/auth/sso/new');
    });
});

describe('SSO actions', () => {
    it('sends exactly the OIDC configuration, including the write-only secret, and redirects to the provider', async () => {
        const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
            Response.json({ provider: OIDC }, { status: 201 }),
        );
        await expect(
            createProvider({
                fetch,
                request: form({
                    type: 'oidc',
                    providerId: 'acme-okta',
                    displayName: 'Acme Okta',
                    domains: 'acme.test, acme.example',
                    issuer: 'https://idp.acme.test',
                    clientId: 'client-1',
                    clientSecret: 'super-secret',
                    enabled: 'on',
                    pkce: 'on',
                    scopes: 'openid email',
                }),
            }),
        ).rejects.toMatchObject({ status: 303, location: '/admin/auth/sso/acme-okta' });
        const init = fetch.mock.calls[0]?.[1];
        expect(JSON.parse(String(init?.body))).toEqual({
            type: 'oidc',
            providerId: 'acme-okta',
            displayName: 'Acme Okta',
            organizationId: null,
            domains: ['acme.test', 'acme.example'],
            enabled: true,
            issuer: 'https://idp.acme.test',
            clientId: 'client-1',
            clientSecret: 'super-secret',
            advanced: { scopes: ['openid', 'email'], pkce: true },
        });
    });

    it('rejects forged or missing fields before calling the API', async () => {
        const fetch = vi.fn(async () => Response.json({}));
        const base = {
            type: 'oidc',
            providerId: 'a-b',
            displayName: 'A',
            domains: 'a.test',
            issuer: 'https://i.test',
            clientId: 'c',
        };
        for (const values of [
            { ...base },
            { ...base, clientSecret: 's', role: 'admin' },
            { ...base, type: 'other', clientSecret: 's' },
            { providerId: '', type: 'oidc' },
        ]) {
            const result = (await createProvider({ fetch, request: form(values) })) as unknown as Result;
            expect(result.status).toBe(400);
        }
        expect(fetch).not.toHaveBeenCalled();
    });

    it('keeps the stored secret when an edit leaves it blank', async () => {
        const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
            Response.json({ provider: OIDC }),
        );
        const result = await updateProvider({
            fetch,
            request: form({
                type: 'oidc',
                providerId: 'acme-okta',
                displayName: 'Renamed',
                domains: 'acme.test',
                issuer: 'https://idp.acme.test',
                clientId: 'client-1',
                clientSecret: '',
            }),
        });
        expect(result).toMatchObject({ saved: true });
        expect(fetch.mock.calls[0]?.[0]).toBe('/__admin/auth/sso/acme-okta');
        expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'PATCH' });
        expect(String(fetch.mock.calls[0]?.[1]?.body)).not.toContain('clientSecret');
    });

    it('builds SAML bodies from metadata and advanced settings', async () => {
        const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
            Response.json({ provider: SAML }, { status: 201 }),
        );
        await expect(
            createProvider({
                fetch,
                request: form({
                    type: 'saml',
                    providerId: 'initech-saml',
                    displayName: 'Initech',
                    domains: 'initech.test',
                    idpMetadata: '<EntityDescriptor/>',
                    idpInitiatedCallbackUrl: '/welcome',
                    enabled: 'on',
                }),
            }),
        ).rejects.toMatchObject({ status: 303 });
        expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
            type: 'saml',
            idpMetadata: '<EntityDescriptor/>',
            advanced: { idpInitiatedCallbackUrl: '/welcome', wantAssertionsSigned: false },
        });
    });

    it('toggles, tests and verifies with only a provider id, and maps failures to fixed messages', async () => {
        const fetch = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
            const path = String(input);
            if (path.endsWith('/test')) {
                return Response.json({
                    result: {
                        providerId: 'acme-okta',
                        type: 'oidc',
                        valid: false,
                        testedAt: 'now',
                        diagnostics: [
                            {
                                code: 'OIDC_DISCOVERY_FAILED',
                                severity: 'error',
                                message: 'OIDC discovery failed; check the issuer and that the IdP is reachable.',
                            },
                        ],
                    },
                });
            }
            if (path.endsWith('/domain-verification')) {
                return Response.json({
                    verification: {
                        providerId: 'acme-okta',
                        status: 'pending',
                        domains: ['acme.test'],
                        recordName: '_nestrum-sso-acme-okta',
                        recordValue: 'tok',
                        expiresAt: null,
                    },
                });
            }
            return Response.json({ provider: OIDC });
        });
        expect(await toggleProvider({ fetch, request: form({ providerId: 'acme-okta' }) }, false)).toMatchObject({
            toggled: 'disabled',
        });
        expect(fetch.mock.calls[0]?.[0]).toBe('/__admin/auth/sso/acme-okta/disable');
        const tested = (await testProvider({ fetch, request: form({ providerId: 'acme-okta' }) })) as {
            test: { valid: boolean };
        };
        expect(tested.test.valid).toBe(false);
        expect(await requestVerification({ fetch, request: form({ providerId: 'acme-okta' }) })).toMatchObject({
            verification: { recordValue: 'tok' },
        });
        expect(await verifyDomain({ fetch, request: form({ providerId: 'acme-okta' }) })).toMatchObject({
            verified: true,
        });
        expect(
            (
                (await toggleProvider(
                    { fetch, request: form({ providerId: 'a', extra: 'x' }) },
                    true,
                )) as unknown as Result
            ).status,
        ).toBe(400);
        const forbidden = (await toggleProvider(
            { fetch: async () => Response.json({}, { status: 403 }), request: form({ providerId: 'acme-okta' }) },
            true,
        )) as unknown as Result;
        expect(forbidden.data.message).toMatch(/permission/);
    });

    it('requires the provider id typed back before deleting', async () => {
        const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
            Response.json({ deleted: true }),
        );
        const refused = (await deleteProvider({
            fetch,
            request: form({ providerId: 'acme-okta', confirm: 'wrong' }),
        })) as unknown as Result;
        expect(refused.status).toBe(400);
        expect(fetch).not.toHaveBeenCalled();
        await expect(
            deleteProvider({ fetch, request: form({ providerId: 'acme-okta', confirm: 'acme-okta' }) }),
        ).rejects.toMatchObject({ status: 303, location: '/admin/auth/sso' });
        expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: 'DELETE' });
    });
});

describe('SSO pages', () => {
    const props = (data: object, form?: object) => ({ props: { data, form } as never });

    it('lists providers with protocol, status and only the permitted actions', async () => {
        const body = (
            await render(
                ListPage,
                props({
                    providers: [OIDC, { ...SAML, enabled: false }],
                    capabilities: { ...ALL, delete: false },
                    message: '',
                }),
            )
        ).body;
        expect(body).toContain('Acme Okta');
        expect(body).toContain('SAML 2.0');
        expect(body).toContain('Disabled');
        expect(body).toContain('action="?/disable"');
        expect(body).toContain('action="?/enable"');
        expect(body).not.toContain('#delete');
        const readOnly = (
            await render(
                ListPage,
                props({
                    providers: [OIDC],
                    capabilities: { ...ALL, update: false, test: false, disable: false, create: false },
                    message: '',
                }),
            )
        ).body;
        expect(readOnly).not.toContain('action="?/test"');
        expect(readOnly).not.toContain('Add a provider');
    });

    it('states that a passing test is not a login', async () => {
        const body = (
            await render(
                ListPage,
                props(
                    { providers: [OIDC], capabilities: ALL, message: '' },
                    { test: { providerId: 'acme-okta', type: 'oidc', valid: true, testedAt: 'now', diagnostics: [] } },
                ),
            )
        ).body;
        expect(body).toContain('not a sign-in');
    });

    it('never renders a stored secret and shows the redirect URI or SP values', async () => {
        const oidc = (await render(DetailPage, props({ provider: OIDC, capabilities: ALL, message: '' }))).body;
        expect(oidc).toContain('Configured — leave blank to keep');
        expect(oidc).toContain('/api/auth/sso/callback/acme-okta');
        expect(oidc).not.toContain('super-secret');
        expect(oidc).toContain('type="password"');
        const saml = (await render(DetailPage, props({ provider: SAML, capabilities: ALL, message: '' }))).body;
        expect(saml).toContain('data-testid="sso-acs-url"');
        expect(saml).toContain('saml2/sp/acs/initech-saml');
        expect(saml).toContain('It does not delete users');
    });

    it('offers DNS instructions when domain verification is pending', async () => {
        const body = (
            await render(
                DetailPage,
                props(
                    { provider: { ...OIDC, domainVerification: 'pending' }, capabilities: ALL, message: '' },
                    { verification: { recordName: '_nestrum-sso-acme-okta', recordValue: 'tok123' } },
                ),
            )
        ).body;
        expect(body).toContain('_nestrum-sso-acme-okta');
        expect(body).toContain('tok123');
    });

    it('renders the protocol-specific creation forms', async () => {
        const oidc = (await render(NewPage, props({ capabilities: ALL, type: 'oidc', message: '' }))).body;
        expect(oidc).toContain('name="clientSecret"');
        expect(oidc).toContain('name="issuer"');
        const saml = (await render(NewPage, props({ capabilities: ALL, type: 'saml', message: '' }))).body;
        expect(saml).toContain('name="idpMetadata"');
        expect(saml).not.toContain('name="clientSecret"');
        const denied = (
            await render(
                NewPage,
                props({
                    capabilities: null,
                    type: 'oidc',
                    message: 'You do not have permission to create SSO providers.',
                }),
            )
        ).body;
        expect(denied).not.toContain('<form');
    });

    it('adds the navigation link only when allowed', async () => {
        const state = { status: 'ready', resources: [], user: null } as never;
        expect((await render(ShellFixture, { props: { state, canManageSso: true } })).body).toContain(
            '/admin/auth/sso',
        );
        expect((await render(ShellFixture, { props: { state } })).body).not.toContain('/admin/auth/sso');
    });
});
