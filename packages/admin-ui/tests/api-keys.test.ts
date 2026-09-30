import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import { ApiKeyClient, createKey, loadApiKeyData, revokeKey, rotateKey } from '../src/lib/api-keys.server.js';
import { load as loadLayout } from '../src/routes/+layout.server.js';
import ApiKeysPage from '../src/routes/api-keys/+page.svelte';
import { resource } from './fixtures.js';
import ShellFixture from './ShellFixture.svelte';

const KEY = {
    id: 'k1',
    name: 'Billing sync',
    start: 'nes_live_abcd',
    owner: { type: 'user', id: 'user-1' },
    scopes: ['projects:read', 'projects:write'],
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-02-01T00:00:00.000Z',
    lastUsedAt: null,
    revokedAt: null,
    rateLimit: { enabled: true, requests: 1000, windowSeconds: 60 },
    metadata: {},
};
const REVOKED = { ...KEY, id: 'k2', name: 'Old', status: 'revoked', revokedAt: '2026-01-05T00:00:00.000Z' };
const SECRET = 'nes_live_THISISTHEONETIMESECRETVALUETHISISTHEONETIMESECRETVALUE1234';
const ALL = { read: true, create: true, revoke: true, rotate: true };
const page = (overrides: object = {}) => ({ keys: [KEY, REVOKED], total: 2, limit: 25, offset: 0, ...overrides });
const url = (path: string) => new URL(`http://localhost${path}`);
function form(values: Record<string, string | string[]>) {
    const data = new FormData();
    for (const [name, value] of Object.entries(values)) {
        for (const item of Array.isArray(value) ? value : [value]) {
            data.append(name, item);
        }
    }

    return new Request('http://localhost/admin/api-keys?/create', { method: 'POST', body: data });
}
const setHeaders = () => vi.fn();
type Result = { status: number; data: { message: string } };

describe('API key client', () => {
    it('requests pages credentialed and uncached', async () => {
        const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => Response.json(page()));
        expect((await new ApiKeyClient(fetch).list({ offset: 25 })).total).toBe(2);
        expect(fetch.mock.calls[0]?.[0]).toBe('/__admin/api-keys?limit=25&offset=25');
        expect(fetch.mock.calls[0]?.[1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store' });
    });

    it('treats failed or malformed capabilities as none and rejects a malformed page', async () => {
        expect(await new ApiKeyClient(async () => Response.json(ALL)).capabilities()).toEqual(ALL);
        expect(await new ApiKeyClient(async () => Response.json({ read: 'yes' })).capabilities()).toBeNull();
        expect(await new ApiKeyClient(async () => Response.json({}, { status: 403 })).capabilities()).toBeNull();
        await expect(
            new ApiKeyClient(async () => Response.json({ keys: [{ id: 1 }], total: 1, limit: 25, offset: 0 })).list({
                offset: 0,
            }),
        ).rejects.toMatchObject({ status: 502 });
    });

    it('shows the layout link only when the API says the subject can read keys', async () => {
        const event = (read: boolean) =>
            ({
                fetch: vi.fn(async (input: string | URL | Request) =>
                    String(input).endsWith('/api-keys/capabilities')
                        ? Response.json({ ...ALL, read })
                        : Response.json(
                              String(input).endsWith('/access/capabilities') ? { users: false } : [resource()],
                          ),
                ),
                depends: vi.fn(),
                url: url('/admin'),
            }) as never;
        expect((await loadLayout(event(true))).canManageApiKeys).toBe(true);
        expect((await loadLayout(event(false))).canManageApiKeys).toBe(false);
    });
});

describe('API key page data', () => {
    it('loads the list for a permitted subject and explains a denial without a table', async () => {
        const fetch = vi.fn(async (input: string | URL | Request) =>
            Response.json(String(input).endsWith('/capabilities') ? ALL : page()),
        );
        expect(await loadApiKeyData(fetch, url('/admin/api-keys?offset=25'))).toMatchObject({
            offset: 25,
            message: '',
        });
        const denied = await loadApiKeyData(
            async (input) =>
                String(input).endsWith('/capabilities')
                    ? Response.json({ ...ALL, read: false })
                    : Response.json({}, { status: 403 }),
            url('/admin/api-keys'),
        );
        expect(denied).toMatchObject({ page: null });
        expect(denied.message).toMatch(/permission/);
        expect((await loadApiKeyData(fetch, url('/admin/api-keys?offset=-1'))).message).toMatch(/not valid/);
    });
});

describe('Create action', () => {
    const created = () =>
        vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
            Response.json({ key: KEY, secret: SECRET }, { status: 201 }),
        );

    it('sends exactly the configured key and returns the one-time reveal with no-store headers', async () => {
        const fetch = created();
        const headers = setHeaders();
        const result = (await createKey({
            fetch,
            setHeaders: headers,
            request: form({
                name: ' Billing sync ',
                ownerId: 'user-1',
                scopes: 'projects:read, projects:write  events:write',
                expiresInDays: '30',
                rateLimitRequests: '100',
                rateLimitWindowSeconds: '10',
            }),
        })) as unknown as { revealed: { name: string; start: string; secret: string } };
        expect(result.revealed).toEqual({ name: 'Billing sync', start: 'nes_live_abcd', secret: SECRET });
        expect(headers).toHaveBeenCalledWith({ 'cache-control': 'no-store' });
        expect(fetch.mock.calls[0]?.[0]).toBe('/__admin/api-keys');
        expect(fetch.mock.calls[0]?.[1]?.method).toBe('POST');
        expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
            name: 'Billing sync',
            ownerId: 'user-1',
            scopes: ['projects:read', 'projects:write', 'events:write'],
            expiresInDays: 30,
            rateLimit: { requests: 100, windowSeconds: 10 },
        });
    });

    it('can disable rate limiting and omits optional values', async () => {
        const fetch = created();
        await createKey({
            fetch,
            setHeaders: setHeaders(),
            request: form({ name: 'k', ownerId: 'u', rateLimitDisabled: 'on' }),
        });
        expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
            name: 'k',
            ownerId: 'u',
            scopes: [],
            rateLimit: { enabled: false },
        });
    });

    it.each([
        [{ ownerId: 'u' }],
        [{ name: 'k' }],
        [{ name: 'x'.repeat(65), ownerId: 'u' }],
        [{ name: 'k', ownerId: 'u', expiresInDays: '0' }],
        [{ name: 'k', ownerId: 'u', expiresInDays: '1.5' }],
        [{ name: 'k', ownerId: 'u', rateLimitRequests: '-1' }],
        [{ name: 'k', ownerId: 'u', rateLimitDisabled: 'yes' }],
        [{ name: ['a', 'b'], ownerId: 'u' }],
        [{ name: 'k', ownerId: 'u', extra: 'x' }],
    ])('rejects malformed form %j before calling the API', async (values) => {
        const fetch = vi.fn();
        const result = (await createKey({
            fetch,
            setHeaders: setHeaders(),
            request: form(values),
        })) as unknown as Result;
        expect(result.status).toBe(400);
        expect(fetch).not.toHaveBeenCalled();
    });

    it.each([
        [400, { error: { code: 'API_KEY_SCOPES_INVALID' } }, /Scopes must look like/],
        [404, { error: { code: 'API_KEY_OWNER_NOT_FOUND' } }, /No user has that ID/],
        [403, { error: { code: 'AUTHORIZATION_DENIED', message: 'stack trace' } }, /permission/],
        [401, {}, /Sign in again/],
        [500, { error: { code: 'X', message: 'stack trace' } }, /Unable to complete/],
    ])('maps a %s response to a safe message', async (status, body, expected) => {
        const fetch = vi.fn(async () => Response.json(body, { status }));
        const result = (await createKey({
            fetch,
            setHeaders: setHeaders(),
            request: form({ name: 'k', ownerId: 'u' }),
        })) as unknown as Result;
        expect(result.status).toBe(status);
        expect(result.data.message).toMatch(expected);
        expect(JSON.stringify(result.data)).not.toContain('stack trace');
    });

    it('never treats a response lacking a secret as success', async () => {
        const result = (await createKey({
            fetch: async () => Response.json({ key: KEY }, { status: 201 }),
            setHeaders: setHeaders(),
            request: form({ name: 'k', ownerId: 'u' }),
        })) as unknown as Result;
        expect(result.status).toBe(502);
    });
});

describe('Revoke and rotate actions', () => {
    it('revoke posts to the key and confirms without revealing anything', async () => {
        const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
            Response.json({ key: REVOKED }),
        );
        const result = await revokeKey({ fetch, request: form({ keyId: 'k 1' }) });
        expect(result).toEqual({ revoked: true, message: '' });
        expect(fetch.mock.calls[0]?.[0]).toBe('/__admin/api-keys/k%201/revoke');
        expect(fetch.mock.calls[0]?.[1]?.method).toBe('POST');
    });

    it('rotate reveals the replacement once with no-store headers', async () => {
        const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
            Response.json({ key: KEY, secret: SECRET, revoked: REVOKED }),
        );
        const headers = setHeaders();
        const result = (await rotateKey({ fetch, setHeaders: headers, request: form({ keyId: 'k1' }) })) as unknown as {
            revealed: { secret: string };
        };
        expect(result.revealed.secret).toBe(SECRET);
        expect(headers).toHaveBeenCalledWith({ 'cache-control': 'no-store' });
        expect(fetch.mock.calls[0]?.[0]).toBe('/__admin/api-keys/k1/rotate');
    });

    it.each([[{}], [{ keyId: ['a', 'b'] }], [{ keyId: 'x'.repeat(129) }], [{ keyId: 'a', extra: 'x' }]])(
        'rejects malformed form %j before calling the API',
        async (values) => {
            const fetch = vi.fn();
            expect(((await revokeKey({ fetch, request: form(values) })) as unknown as Result).status).toBe(400);
            expect(
                ((await rotateKey({ fetch, setHeaders: setHeaders(), request: form(values) })) as unknown as Result)
                    .status,
            ).toBe(400);
            expect(fetch).not.toHaveBeenCalled();
        },
    );

    it.each([
        [409, { error: { code: 'API_KEY_NOT_ROTATABLE' } }, /Only active keys/],
        [404, { error: { code: 'API_KEY_NOT_FOUND' } }, /no longer exists/],
    ])('maps a %s rotate failure to a safe message', async (status, body, expected) => {
        const result = (await rotateKey({
            fetch: async () => Response.json(body, { status }),
            setHeaders: setHeaders(),
            request: form({ keyId: 'k1' }),
        })) as unknown as Result;
        expect(result.status).toBe(status);
        expect(result.data.message).toMatch(expected);
    });
});

describe('API key page rendering', () => {
    const base = { admin: { status: 'ready', resources: [] }, path: '/admin/api-keys', canManageUsers: false };
    const data = (overrides: object = {}) => ({
        ...base,
        page: page(),
        capabilities: ALL,
        message: '',
        offset: 0,
        ...overrides,
    });

    it('renders a safe list with native forms, never a secret, and actions only for active keys', async () => {
        const output = await render(ApiKeysPage, { props: { data: data(), form: null } as never });
        expect(output.body).toContain('Billing sync');
        expect(output.body).toContain('nes_live_abcd…');
        expect(output.body).toContain('projects:read, projects:write');
        expect(output.body).toContain('action="?/create"');
        expect(output.body.match(/action="\?\/rotate"/g)).toHaveLength(1);
        expect(output.body.match(/action="\?\/revoke"/g)).toHaveLength(1);
        expect(output.body).not.toContain(SECRET);
        expect(output.body).not.toMatch(/<script/i);
    });

    it('reveals a fresh secret with the not-shown-again warning', async () => {
        const output = await render(ApiKeysPage, {
            props: {
                data: data(),
                form: { revealed: { name: 'Billing sync', start: 'nes_live_abcd', secret: SECRET }, message: '' },
            } as never,
        });
        expect(output.body).toContain('This key will not be shown again.');
        expect(output.body).toContain(SECRET);
        // Once the page is loaded again (no form state) the secret is gone.
        const later = await render(ApiKeysPage, { props: { data: data(), form: null } as never });
        expect(later.body).not.toContain(SECRET);
        expect(later.body).not.toContain('will not be shown again');
    });

    it('hides controls the subject lacks and escapes hostile values', async () => {
        const hostile = { ...KEY, name: '<img src=x onerror=alert(1)>', scopes: ['<b>x</b>'] };
        const output = await render(ApiKeysPage, {
            props: {
                data: data({
                    page: page({ keys: [hostile], total: 60, offset: 25 }),
                    capabilities: { read: true, create: false, revoke: false, rotate: false },
                    offset: 25,
                }),
                form: { message: 'That key no longer exists.' },
            } as never,
        });
        expect(output.body).not.toContain('<img src=x');
        expect(output.body).toContain('&lt;img');
        expect(output.body).not.toContain('action="?/create"');
        expect(output.body).not.toContain('action="?/rotate"');
        expect(output.body).not.toContain('action="?/revoke"');
        expect(output.body).toContain('href="?offset=0"');
        expect(output.body).toContain('href="?offset=50"');
        expect(output.body).toContain('no longer exists');
    });

    it('shows a load failure without a table', async () => {
        const output = await render(ApiKeysPage, {
            props: {
                data: data({ page: null, message: 'You do not have permission to manage API keys.' }),
                form: null,
            } as never,
        });
        expect(output.body).toContain('permission');
        expect(output.body).not.toContain('<table');
    });

    it('adds the shell link only when allowed', async () => {
        const state = { status: 'ready', resources: [resource()] } as const;
        expect((await render(ShellFixture, { props: { state, canManageApiKeys: true } })).body).toContain(
            'href="/admin/api-keys"',
        );
        expect((await render(ShellFixture, { props: { state } })).body).not.toContain('/admin/api-keys');
    });
});
