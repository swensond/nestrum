import type { AuthenticationDefinition, PolicyDefinition, QuerySpec, ResourceConfig } from '@nestrum/core';
import { API_KEY_HEADER, ApiKeyError, allow, defineApplication, defineResource, deny, eq } from '@nestrum/core';
import { generateModelSchemas } from '@nestrum/zod';
import { describe, expect, it, vi } from 'vitest';
import { createHonoRuntime } from '../src/index.js';

const FIELD = {
    codec: 'pg/text@1',
    nullable: false,
    optional: false,
    array: false,
    hasCreateDefault: false,
    hasUpdateDefault: false,
} as const;
const METADATA = {
    name: 'Project',
    identity: 'Project',
    provider: 'postgresql',
    namespace: 'public',
    relations: [],
    fields: [
        { ...FIELD, name: 'id', kind: 'integer', codec: 'pg/int4@1', primaryKey: true, hasCreateDefault: true },
        { ...FIELD, name: 'name', kind: 'string', primaryKey: false },
        { ...FIELD, name: 'ownerId', kind: 'string', primaryKey: false },
    ],
} as const;
const ROW = { id: 1, name: 'Project one', ownerId: 'owner-1' };
const SCOPES: Record<string, readonly string[]> = {
    'read-key': ['projects:read'],
    'write-key': ['projects:read', 'projects:write'],
    'wild-key': ['projects:*'],
    'other-key': ['events:write'],
    'custom-key': ['projects:archive'],
};

/** A stand-in for the framework-owned verifier: the credential decides the outcome, like the real one. */
function stubAuth(authenticate = vi.fn()): { definition: AuthenticationDefinition; authenticate: typeof authenticate } {
    authenticate.mockImplementation(async (request: Request) => {
        const credential = request.headers.get(API_KEY_HEADER);
        if (credential === null) {
            return null;
        }
        if (credential === 'limited') {
            throw new ApiKeyError('API_KEY_RATE_LIMITED', 'The API key has exceeded its rate limit.', 429, {
                'Retry-After': '7',
            });
        }
        if (!SCOPES[credential]) {
            throw ApiKeyError.unauthenticated('API_KEY_INVALID', 'The API key is not valid.');
        }

        return {
            id: `id-${credential}`,
            name: credential,
            owner: { type: 'user', id: 'owner-1' },
            scopes: SCOPES[credential],
        };
    });

    return {
        authenticate,
        definition: {
            kind: 'better-auth',
            protectedModels: [],
            createApp: () => ({ name: 'test.auth' }),
            initialize: async () =>
                ({
                    basePath: '/api/auth',
                    handle: async () => new Response(null, { status: 404 }),
                    apiKeys: { authenticate },
                    getSession: async () => null,
                    resolveSubject: async (request: Request) =>
                        request.headers.get('cookie') === 'session=valid'
                            ? { id: 'owner-1', anonymous: false, role: 'user' }
                            : { anonymous: true },
                }) as never,
        },
    };
}

const POLICY: PolicyDefinition = {
    resource: 'Project',
    actions: {
        read: {
            scope: ({ subject }) =>
                eq(
                    'ownerId',
                    (subject.type === 'api-key' ? (subject.owner as { id: string }).id : subject.id) as string,
                ),
        },
        create: { authorize: ({ subject }) => (subject.id ? allow() : deny('ANONYMOUS')) },
        update: { authorize: ({ subject }) => (subject.id ? allow() : deny('ANONYMOUS')) },
        delete: {
            // ABAC can deny a request the key's scope allows: keys may never delete.
            authorize: ({ subject }) => (subject.type === 'api-key' ? deny('KEYS_CANNOT_DELETE') : allow()),
        },
    },
};

function fixture(api: ResourceConfig['api'], withAuth = true) {
    const { definition, authenticate } = stubAuth();
    const backend = {
        raw: {},
        all: vi.fn(async (_query: QuerySpec): Promise<Record<string, unknown>[]> => [{ ...ROW }]),
        count: vi.fn(async () => 1),
        create: vi.fn(async (data: object): Promise<Record<string, unknown>> => ({ ...ROW, ...data })),
        update: vi.fn(async () => 1),
        delete: vi.fn(async () => 1),
    };
    const application = defineApplication({
        apps: [],
        database: { kind: 'prisma', provider: 'postgresql', connection: 'unused' },
        resources: [defineResource({ model: 'Project', ...(api === undefined ? {} : { api }) })],
        resourceModels: [{ ...generateModelSchemas(METADATA as never), queryBackend: backend }],
        policies: [POLICY],
        ...(withAuth ? { auth: definition } : {}),
    });
    const runtime = createHonoRuntime({ application, onError: vi.fn() });

    return { runtime, backend, authenticate };
}

const call = (
    runtime: ReturnType<typeof fixture>['runtime'],
    path: string,
    headers: Record<string, string>,
    init: RequestInit = {},
) =>
    runtime.hono.request(path, {
        ...init,
        headers: { ...headers, ...(init.body ? { 'content-type': 'application/json' } : {}) },
    });
const key = (value: string) => ({ [API_KEY_HEADER]: value });
const BOTH = {
    list: true,
    retrieve: true,
    create: true,
    update: true,
    delete: true,
    auth: ['session', 'api-key'],
} as const;

describe('API-key authentication on resource APIs', () => {
    it('authenticates a key into an explicit subject whose ABAC policies still run', async () => {
        const { runtime, backend } = fixture(BOTH);
        await runtime.start();
        const response = await call(runtime, '/api/projects', key('read-key'));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual([ROW]);
        // The collection scope used the key's owner, proving the policy saw the api-key subject, not a user.
        expect(backend.all).toHaveBeenLastCalledWith({
            filters: [{ ownerId: { equals: 'owner-1' } }],
            orderBy: [],
            limit: 20,
        });
    });

    it('requires the read scope for list and retrieve and the write scope for mutations', async () => {
        const { runtime, backend } = fixture(BOTH);
        await runtime.start();
        const body = JSON.stringify({ name: 'New', ownerId: 'owner-1' });
        const denied = await call(runtime, '/api/projects', key('other-key'));
        expect(denied.status).toBe(403);
        expect(await denied.json()).toEqual({
            error: { code: 'API_KEY_SCOPE_DENIED', message: 'The API key lacks the required scope projects:read.' },
        });
        expect((await call(runtime, '/api/projects/1', key('other-key'))).status).toBe(403);
        expect((await call(runtime, '/api/projects', key('read-key'), { method: 'POST', body })).status).toBe(403);
        expect(
            (await call(runtime, '/api/projects/1', key('read-key'), { method: 'PATCH', body: '{"name":"x"}' })).status,
        ).toBe(403);
        expect(backend.create).not.toHaveBeenCalled();
        expect((await call(runtime, '/api/projects', key('write-key'), { method: 'POST', body })).status).toBe(201);
        expect(
            (await call(runtime, '/api/projects/1', key('write-key'), { method: 'PATCH', body: '{"name":"x"}' }))
                .status,
        ).toBe(204);
        // A prefix wildcard grants every action on that resource only.
        expect((await call(runtime, '/api/projects', key('wild-key'))).status).toBe(200);
        expect((await call(runtime, '/api/projects', key('wild-key'), { method: 'POST', body })).status).toBe(201);
    });

    it('requires both the scope and ABAC to allow: either denial denies', async () => {
        const { runtime, backend } = fixture(BOTH);
        await runtime.start();
        // Scope allows delete (projects:write) but the policy denies key subjects.
        const response = await call(runtime, '/api/projects/1', key('write-key'), { method: 'DELETE' });
        expect(response.status).toBe(403);
        expect((await response.json()) as never).toMatchObject({
            error: { code: 'AUTHORIZATION_DENIED', reason: 'KEYS_CANNOT_DELETE' },
        });
        expect(backend.delete).not.toHaveBeenCalled();
        // A human session on the same route is still governed only by its own policies.
        expect((await call(runtime, '/api/projects/1', { cookie: 'session=valid' }, { method: 'DELETE' })).status).toBe(
            204,
        );
    });

    it('supports per-operation scope overrides and fails closed for malformed scopes', async () => {
        const { runtime } = fixture({ ...BOTH, scopes: { update: 'projects:archive' } });
        await runtime.start();
        expect(
            (await call(runtime, '/api/projects/1', key('write-key'), { method: 'PATCH', body: '{"name":"x"}' }))
                .status,
        ).toBe(403);
        expect(
            (await call(runtime, '/api/projects/1', key('custom-key'), { method: 'PATCH', body: '{"name":"x"}' }))
                .status,
        ).toBe(204);
        expect(() =>
            defineResource({ model: 'Project', api: { list: true, scopes: { list: 'Projects Read' } } }),
        ).toThrow(/api\.scopes/);
        expect(() => defineResource({ model: 'Project', api: { list: true, scopes: { list: 'projects:*' } } })).toThrow(
            /api\.scopes/,
        );
        expect(() =>
            defineResource({ model: 'Project', api: { list: true, scopes: { purge: 'projects:read' } as never } }),
        ).toThrow(/api\.scopes/);
    });

    it('keeps resources session-only unless they opt in, and refuses keys there', async () => {
        const { runtime, backend } = fixture({ list: true, retrieve: true });
        await runtime.start();
        const response = await call(runtime, '/api/projects', key('read-key'));
        expect(response.status).toBe(401);
        expect(response.headers.get('www-authenticate')).toBe('X-API-Key');
        expect(((await response.json()) as { error: { code: string } }).error.code).toBe('API_KEY_NOT_ACCEPTED');
        expect(backend.all).not.toHaveBeenCalled();
        expect((await call(runtime, '/api/projects', { cookie: 'session=valid' })).status).toBe(200);
    });

    it('requires a key when a resource accepts only api-key', async () => {
        const { runtime } = fixture({ list: true, auth: ['api-key'] });
        await runtime.start();
        const session = await call(runtime, '/api/projects', { cookie: 'session=valid' });
        expect(session.status).toBe(401);
        expect(((await session.json()) as { error: { code: string } }).error.code).toBe('API_KEY_REQUIRED');
        expect(session.headers.get('www-authenticate')).toBe('X-API-Key');
        expect((await call(runtime, '/api/projects', {})).status).toBe(401);
        expect((await call(runtime, '/api/projects', key('read-key'))).status).toBe(200);
    });

    it('fails invalid and rate-limited keys immediately with safe errors and no session fallback', async () => {
        const { runtime, backend } = fixture(BOTH);
        await runtime.start();
        // A valid session cookie does not rescue a bad key.
        const invalid = await call(runtime, '/api/projects', {
            ...key('nes_live_secretvalue'),
            cookie: 'session=valid',
        });
        expect(invalid.status).toBe(401);
        expect(invalid.headers.get('www-authenticate')).toBe('X-API-Key');
        const text = await invalid.text();
        expect(JSON.parse(text)).toEqual({ error: { code: 'API_KEY_INVALID', message: 'The API key is not valid.' } });
        expect(text).not.toContain('secretvalue');
        const limited = await call(runtime, '/api/projects', key('limited'));
        expect(limited.status).toBe(429);
        expect(limited.headers.get('retry-after')).toBe('7');
        expect(backend.all).not.toHaveBeenCalled();
    });

    it('never consults keys for admin, the auth endpoints or the OpenAPI document', async () => {
        const { runtime, authenticate } = fixture(BOTH);
        await runtime.start();
        for (const path of ['/api/auth/get-session', '/__admin/resources', '/admin', '/api/openapi.json', '/health']) {
            await call(runtime, path, key('read-key'));
        }
        expect(authenticate).not.toHaveBeenCalled();
    });

    it('refuses to start when a resource accepts keys but authentication is not configured', async () => {
        const { runtime } = fixture(BOTH, false);
        await expect(runtime.start()).rejects.toMatchObject({ code: 'HTTP_API_AUTH_UNCONFIGURED' });
    });

    it('documents the scheme, required scope and error responses in OpenAPI only for key-enabled resources', async () => {
        const enabled = fixture(BOTH);
        await enabled.runtime.start();
        const document = enabled.runtime.getOpenApiDocument() as never as {
            components: { securitySchemes: Record<string, unknown> };
            paths: Record<string, Record<string, { security: unknown[]; description: string; responses: object }>>;
        };
        expect(document.components.securitySchemes.ApiKeyAuth).toEqual({
            type: 'apiKey',
            in: 'header',
            name: 'X-API-Key',
        });
        const list = document.paths['/api/projects']?.get;
        expect(list?.security).toEqual([{ ApiKeyAuth: [] }, {}]);
        expect(list?.description).toContain('projects:read');
        expect(Object.keys(list?.responses ?? {})).toEqual(expect.arrayContaining(['401', '429']));
        const only = fixture({ list: true, auth: ['api-key'] });
        await only.runtime.start();
        const onlyDoc = only.runtime.getOpenApiDocument() as never as typeof document;
        expect(onlyDoc.paths['/api/projects']?.get?.security).toEqual([{ ApiKeyAuth: [] }]);
        const plain = fixture({ list: true });
        await plain.runtime.start();
        const plainDoc = plain.runtime.getOpenApiDocument() as never as typeof document;
        expect(plainDoc.components?.securitySchemes).toBeUndefined();
        expect(plainDoc.paths['/api/projects']?.get?.security).toBeUndefined();
    });

    it('validates resource auth modes', () => {
        for (const auth of [[], ['session', 'session'], ['basic'], 'api-key'] as never[]) {
            expect(() => defineResource({ model: 'Project', api: { list: true, auth } })).toThrow(/api\.auth/);
        }
        expect(defineResource({ model: 'Project', api: { list: true } }).apiAccess).toEqual({
            auth: ['session'],
            scopes: {},
        });
    });
});
