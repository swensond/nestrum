import type { FieldMetadata, ModelMetadata, PolicyDefinition, QuerySpec, ResourceConfig } from '@nestrum/core';
import { allow, defineApplication, defineResource, deny, eq } from '@nestrum/core';
import { generateModelSchemas } from '@nestrum/zod';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { PublicApiOptions, RequestScope } from '../src/index.js';
import { createHonoRuntime } from '../src/index.js';

const ALL_OPERATIONS = { list: true, retrieve: true, create: true, update: true, delete: true } as const;
const ROW = { id: 1, name: 'Project one', ownerId: 'alice', createdAt: new Date('2026-01-01T00:00:00Z'), budget: 42n };
const JSON_ROW = { ...ROW, createdAt: ROW.createdAt.toISOString(), budget: '42' };

function field(
    name: string,
    kind: FieldMetadata['kind'] = 'string',
    overrides: Partial<FieldMetadata> = {},
): FieldMetadata {
    return {
        name,
        kind,
        codec: kind === 'integer' ? 'pg/int4@1' : kind === 'bigint' ? 'pg/int8@1' : 'pg/text@1',
        nullable: false,
        optional: false,
        array: false,
        primaryKey: name === 'id',
        hasCreateDefault: name === 'id',
        hasUpdateDefault: false,
        ...overrides,
    };
}
const FIELDS = [
    field('id', 'integer'),
    field('name'),
    field('ownerId'),
    field('createdAt', 'date'),
    field('budget', 'bigint'),
];
const OWNER_POLICY: PolicyDefinition = {
    resource: 'Project',
    actions: {
        read: { scope: ({ subject }) => eq('ownerId', subject.id as string) },
        create: { object: ({ subject, resource }) => (resource?.ownerId === subject.id ? allow() : deny('NOT_OWNER')) },
        update: { scope: ({ subject }) => eq('ownerId', subject.id as string) },
        delete: { scope: ({ subject }) => eq('ownerId', subject.id as string) },
    },
};

function fixture(
    options: {
        api?: ResourceConfig['api'];
        schemas?: ResourceConfig['schemas'];
        policies?: readonly PolicyDefinition[];
        fields?: readonly FieldMetadata[];
        relations?: ModelMetadata['relations'];
        publicApi?: PublicApiOptions;
    } = {},
) {
    const metadata: ModelMetadata = {
        name: 'Project',
        identity: 'Project',
        provider: 'postgresql',
        namespace: 'public',
        relations: options.relations ?? [],
        fields: options.fields ?? FIELDS,
    };
    const generated = generateModelSchemas(metadata);
    const backend = {
        raw: { native: true },
        all: vi.fn(async (_query: QuerySpec): Promise<Record<string, unknown>[]> => [{ ...ROW }]),
        count: vi.fn(async (_query: QuerySpec) => 1),
        create: vi.fn(async (data: object): Promise<Record<string, unknown>> => ({ ...ROW, ...data })),
        update: vi.fn(async (_query: QuerySpec, _data: object) => 1),
        delete: vi.fn(async (_query: QuerySpec) => 1),
    };
    const shutdown = vi.fn();
    const app = defineApplication({
        apps: [{ name: 'projects', shutdown }],
        database: { kind: 'prisma', provider: 'postgresql', connection: 'unused' },
        resources: [
            defineResource({
                model: 'Project',
                api: options.api === undefined ? ALL_OPERATIONS : options.api,
                ...(options.schemas ? { schemas: options.schemas } : {}),
            }),
        ],
        resourceModels: [{ ...generated, queryBackend: backend }],
        policies: options.policies ?? [{ ...OWNER_POLICY, resource: metadata.identity }],
    });
    const scopes: RequestScope[] = [];
    const onError = vi.fn();
    const runtime = createHonoRuntime({
        application: app,
        resolveSubject: () => ({ id: 'alice' }),
        onError,
        setupScope: (scope) => {
            scopes.push(scope);
        },
        ...(options.publicApi ? { publicApi: options.publicApi } : {}),
    });

    return { app, runtime, backend, scopes, onError, shutdown };
}

function jsonRequest(method: string, body: unknown): RequestInit {
    return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

describe('Opt-in public resource routes', () => {
    it('lists, retrieves, creates, updates and deletes through scoped QuerySets and disposes every request', async () => {
        const { runtime, backend, scopes } = fixture();
        await runtime.start();
        const list = await runtime.hono.request('/api/projects?limit=2&orderBy=-createdAt,name');
        expect(list.status).toBe(200);
        expect(await list.json()).toEqual([JSON_ROW]);
        expect(backend.all).toHaveBeenLastCalledWith({
            filters: [{ ownerId: { equals: 'alice' } }],
            orderBy: [
                { field: 'createdAt', direction: 'desc' },
                { field: 'name', direction: 'asc' },
            ],
            limit: 2,
        });
        expect(await (await runtime.hono.request('/api/projects/1')).json()).toEqual(JSON_ROW);
        expect(backend.all).toHaveBeenLastCalledWith({
            filters: [{ id: 1 }, { ownerId: { equals: 'alice' } }],
            orderBy: [],
            limit: 2,
        });
        const { id: _id, ...input } = JSON_ROW;
        const created = await runtime.hono.request('/api/projects', jsonRequest('POST', input));
        expect(created.status).toBe(201);
        expect(await created.json()).toEqual(JSON_ROW);
        const { id: _createdId, ...runtimeInput } = ROW;
        expect(backend.create).toHaveBeenCalledWith(runtimeInput);
        const updated = await runtime.hono.request('/api/projects/1', jsonRequest('PATCH', { name: 'Changed' }));
        expect(updated.status).toBe(204);
        expect(await updated.text()).toBe('');
        expect(backend.update).toHaveBeenCalledWith(
            { filters: [{ id: 1 }, { ownerId: { equals: 'alice' } }], orderBy: [] },
            { name: 'Changed' },
        );
        const deleted = await runtime.hono.request('/api/projects/1', { method: 'DELETE' });
        expect(deleted.status).toBe(204);
        expect(backend.delete).toHaveBeenCalledWith({
            filters: [{ id: 1 }, { ownerId: { equals: 'alice' } }],
            orderBy: [],
        });
        expect(scopes).toHaveLength(5);
        expect(scopes.every((scope) => scope.disposed)).toBe(true);
        await runtime.shutdown();
    });

    it.each(['list', 'retrieve', 'create', 'update', 'delete'] as const)(
        'registers only the enabled %s operation and its OpenAPI entry',
        async (operation) => {
            const { runtime } = fixture({ api: { [operation]: true } });
            await runtime.start();
            const operations = [
                ['list', '/api/projects', undefined],
                ['retrieve', '/api/projects/1', undefined],
                [
                    'create',
                    '/api/projects',
                    jsonRequest('POST', { name: 'New', ownerId: 'alice', createdAt: JSON_ROW.createdAt, budget: '42' }),
                ],
                ['update', '/api/projects/1', jsonRequest('PATCH', { name: 'Updated' })],
                ['delete', '/api/projects/1', { method: 'DELETE' }],
            ] as const;
            for (const [candidate, path, init] of operations) {
                expect((await runtime.hono.request(path, init)).status).toBe(
                    candidate === operation
                        ? candidate === 'create'
                            ? 201
                            : candidate === 'update' || candidate === 'delete'
                              ? 204
                              : 200
                        : 404,
                );
            }
            const document = runtime.getOpenApiDocument();
            expect(Object.values(document.paths ?? {}).flatMap((path) => Object.keys(path ?? {}))).toHaveLength(1);
            expect(JSON.stringify(document)).toContain(`Project.${operation}`);
            await runtime.shutdown();
        },
    );

    it.each([false, {}] as const)('does not expose private resources or documentation when api is %s', async (api) => {
        const { runtime, backend } = fixture({ api });
        await runtime.start();
        expect((await runtime.hono.request('/api/projects')).status).toBe(404);
        expect((await runtime.hono.request('/api/openapi.json')).status).toBe(404);
        expect(runtime.getOpenApiDocument().paths).toEqual({});
        expect(backend.all).not.toHaveBeenCalled();
        await runtime.shutdown();
    });

    it('omits private resources from shared discovery', async () => {
        const resources = [
            defineResource({ model: 'Project', api: { list: true } }),
            defineResource({ model: 'User', api: false }),
        ];
        const all = vi.fn(async (_query: QuerySpec) => [{ ...ROW }]);
        const backend = {
            raw: {},
            all,
            count: async () => 0,
            create: async () => ({ ...ROW }),
            update: async () => 0,
            delete: async () => 0,
        };
        const models = resources.map((resource) => ({
            ...generateModelSchemas({
                name: resource.model,
                identity: resource.identity,
                provider: 'postgresql',
                namespace: 'public',
                relations: [],
                fields: FIELDS,
            }),
            queryBackend: backend,
        }));
        const app = defineApplication({
            apps: [],
            resources,
            resourceModels: models,
            database: { kind: 'prisma', provider: 'postgresql', connection: 'unused' },
            policies: resources.map((resource) => ({
                resource: resource.identity,
                actions: { read: { authorize: () => allow() } },
            })),
        });
        const runtime = createHonoRuntime({ application: app });
        await runtime.start();
        expect((await runtime.hono.request('/api/projects')).status).toBe(200);
        expect((await runtime.hono.request('/api/users')).status).toBe(404);
        expect(Object.keys(runtime.getOpenApiDocument().paths ?? {})).toEqual(['/api/projects']);
        expect(JSON.stringify(runtime.getOpenApiDocument())).not.toContain('User');
        await runtime.shutdown();
    });
});

describe('Public validation and authorization', () => {
    it('round-trips nullable and optional scalar arrays through generated schemas', async () => {
        const arrays = [
            field('id', 'integer'),
            field('moments', 'date', { array: true, nullable: true }),
            field('amounts', 'bigint', { array: true, optional: true }),
        ];
        const { runtime, backend } = fixture({
            fields: arrays,
            policies: [{ resource: 'Project', actions: { create: { authorize: () => allow() } } }],
        });
        backend.create.mockImplementation(async (data) => ({ id: 1, ...data }));
        await runtime.start();
        const created = await runtime.hono.request(
            '/api/projects',
            jsonRequest('POST', { moments: [JSON_ROW.createdAt], amounts: ['-42', '9223372036854775807'] }),
        );
        expect(created.status).toBe(201);
        expect(await created.json()).toEqual({
            id: 1,
            moments: [JSON_ROW.createdAt],
            amounts: ['-42', '9223372036854775807'],
        });
        expect(backend.create.mock.lastCall?.[0]).toEqual({
            moments: [ROW.createdAt],
            amounts: [-42n, 9223372036854775807n],
        });
        const nullable = await runtime.hono.request('/api/projects', jsonRequest('POST', { moments: null }));
        expect(nullable.status).toBe(201);
        expect(await nullable.json()).toEqual({ id: 1, moments: null });
        await runtime.shutdown();
    });

    it('supports an application-provided Temporal implementation for native Prisma scalar values', async () => {
        class Instant {
            constructor(readonly value: string) {}
            static from(value: string) {
                return new Instant(value);
            }
            toString() {
                return this.value;
            }
            toJSON() {
                return this.value;
            }
        }
        const metadata: ModelMetadata = {
            identity: 'Event',
            name: 'Event',
            namespace: 'public',
            provider: 'postgresql',
            relations: [],
            fields: [field('id', 'integer'), field('at', 'temporal-instant')],
        };
        const create = vi.fn(async (data: object) => ({ id: 1, ...data }));
        const backend = {
            raw: {},
            all: async () => [],
            count: async () => 0,
            create,
            update: async () => 0,
            delete: async () => 0,
        };
        const app = defineApplication({
            apps: [],
            database: { kind: 'prisma', provider: 'postgresql', connection: 'unused' },
            resources: [defineResource({ model: 'Event', api: { create: true } })],
            resourceModels: [{ ...generateModelSchemas(metadata, { temporal: { Instant } }), queryBackend: backend }],
            policies: [{ resource: 'Event', actions: { create: { authorize: () => allow() } } }],
        });
        const runtime = createHonoRuntime({ application: app, publicApi: { temporal: { Instant } }, onError: vi.fn() });
        await runtime.start();
        const response = await runtime.hono.request('/api/events', jsonRequest('POST', { at: JSON_ROW.createdAt }));
        expect(response.status).toBe(201);
        expect(await response.json()).toEqual({ id: 1, at: JSON_ROW.createdAt });
        expect(create).toHaveBeenCalledWith({ at: expect.any(Instant) });
        await runtime.shutdown();
    });

    it('keeps composed input transforms single-pass and preserves their OpenAPI constraints', async () => {
        const { runtime, backend } = fixture({
            schemas: {
                create: (schema) =>
                    schema.extend({
                        name: z
                            .string()
                            .min(3)
                            .transform((value) => `${value}!`),
                    }),
            },
        });
        await runtime.start();
        const input = { name: 'Hello', ownerId: 'alice', createdAt: JSON_ROW.createdAt, budget: '42' };
        expect((await runtime.hono.request('/api/projects', jsonRequest('POST', input))).status).toBe(201);
        expect(backend.create.mock.lastCall?.[0]).toMatchObject({
            name: 'Hello!',
            createdAt: ROW.createdAt,
            budget: 42n,
        });
        expect(JSON.stringify(runtime.getOpenApiDocument())).toContain('"minLength":3');
        expect((await runtime.hono.request('/api/projects', jsonRequest('POST', { ...input, name: 'x' }))).status).toBe(
            400,
        );
        expect(backend.create).toHaveBeenCalledTimes(1);
        await runtime.shutdown();
    });

    it.each([
        '/api/projects?limit=101',
        '/api/projects?limit=-1',
        '/api/projects?limit=1.2',
        '/api/projects?limit=1&limit=2',
        '/api/projects?select=name',
        '/api/projects?include=owner',
        '/api/projects?where={}',
        '/api/projects?orderBy=missing',
        '/api/projects/1?limit=1',
        '/api/projects/bad',
    ])('rejects invalid query/path input %s before data access', async (path) => {
        const { runtime, backend } = fixture();
        await runtime.start();
        expect((await runtime.hono.request(path)).status).toBe(400);
        expect(backend.all).not.toHaveBeenCalled();
        await runtime.shutdown();
    });

    it('bounds default lists, retains deny checks at limit zero, and rejects malformed or nested writes', async () => {
        const { runtime, backend } = fixture();
        await runtime.start();
        expect((await runtime.hono.request('/api/projects')).status).toBe(200);
        expect(backend.all.mock.lastCall?.[0].limit).toBe(20);
        expect(await (await runtime.hono.request('/api/projects?limit=0')).json()).toEqual([]);
        const input = { name: 'New', ownerId: 'alice', createdAt: JSON_ROW.createdAt, budget: '42' };
        for (const body of [
            null,
            [],
            {},
            { ...input, budget: 42 },
            { ...input, budget: '9223372036854775808' },
            { ...input, createdAt: 'bad' },
            { ...input, relation: { create: {} } },
        ]) {
            expect((await runtime.hono.request('/api/projects', jsonRequest('POST', body))).status).toBe(400);
        }
        expect((await runtime.hono.request('/api/projects', { method: 'POST', body: '{}' })).status).toBe(415);
        expect(
            (
                await runtime.hono.request('/api/projects', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: '{',
                })
            ).status,
        ).toBe(400);
        expect((await runtime.hono.request('/api/projects/1', jsonRequest('PATCH', {}))).status).toBe(400);
        expect((await runtime.hono.request('/api/projects/1', jsonRequest('PATCH', { id: 2 }))).status).toBe(400);
        expect(backend.create).not.toHaveBeenCalled();
        expect(backend.update).not.toHaveBeenCalled();
        await runtime.shutdown();
    });

    it('denies missing policies and zero-limit reads, and separates read from write actions', async () => {
        const absent = fixture({ policies: [] });
        await absent.runtime.start();
        expect((await absent.runtime.hono.request('/api/projects?limit=0')).status).toBe(403);
        expect((await absent.runtime.hono.request('/api/projects/1', { method: 'DELETE' })).status).toBe(403);
        expect(absent.backend.all).not.toHaveBeenCalled();
        expect(absent.backend.delete).not.toHaveBeenCalled();
        await absent.runtime.shutdown();
        const onlyRead = fixture({
            policies: [{ resource: 'Project', actions: { read: { authorize: () => allow() } } }],
        });
        await onlyRead.runtime.start();
        expect((await onlyRead.runtime.hono.request('/api/projects')).status).toBe(200);
        expect(
            (await onlyRead.runtime.hono.request('/api/projects/1', jsonRequest('PATCH', { name: 'Changed' }))).status,
        ).toBe(403);
        expect(onlyRead.backend.update).not.toHaveBeenCalled();
        await onlyRead.runtime.shutdown();
    });

    it('allows authorized mutations without a read grant and preserves resource-level denial', async () => {
        const write = fixture({
            policies: [
                {
                    resource: 'Project',
                    actions: { update: { authorize: () => allow() }, delete: { authorize: () => allow() } },
                },
            ],
        });
        await write.runtime.start();
        expect(
            (await write.runtime.hono.request('/api/projects/1', jsonRequest('PATCH', { name: 'Changed' }))).status,
        ).toBe(204);
        expect((await write.runtime.hono.request('/api/projects/1', { method: 'DELETE' })).status).toBe(204);
        expect(write.backend.all).not.toHaveBeenCalled();
        await write.runtime.shutdown();
        const denied = fixture({
            policies: [
                {
                    ...OWNER_POLICY,
                    authorize: ({ environment }) =>
                        environment.method === 'GET' && environment.path === '/api/projects'
                            ? deny('RESOURCE_DISABLED')
                            : allow(),
                },
            ],
        });
        await denied.runtime.start();
        const response = await denied.runtime.hono.request('/api/projects');
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ error: { reason: 'RESOURCE_DISABLED' } });
        expect(denied.backend.all).not.toHaveBeenCalled();
        await denied.runtime.shutdown();
    });

    it('denies object reads and creation, and never bypasses object-mutation restrictions', async () => {
        const actions = Object.fromEntries(
            ['read', 'create', 'update', 'delete'].map((name) => [name, { object: () => deny('NOT_OWNER') }]),
        );
        const { runtime, backend } = fixture({ policies: [{ resource: 'Project', actions }] });
        await runtime.start();
        expect((await runtime.hono.request('/api/projects/1')).status).toBe(403);
        expect(
            (
                await runtime.hono.request(
                    '/api/projects',
                    jsonRequest('POST', { name: 'New', ownerId: 'bob', createdAt: JSON_ROW.createdAt, budget: '42' }),
                )
            ).status,
        ).toBe(403);
        expect((await runtime.hono.request('/api/projects/1', jsonRequest('PATCH', { name: 'Changed' }))).status).toBe(
            403,
        );
        expect((await runtime.hono.request('/api/projects/1', { method: 'DELETE' })).status).toBe(403);
        expect(backend.create).not.toHaveBeenCalled();
        expect(backend.update).not.toHaveBeenCalled();
        expect(backend.delete).not.toHaveBeenCalled();
        await runtime.shutdown();
    });

    it('preserves item identity when a composed Where schema strips caller filters', async () => {
        const { runtime, backend } = fixture({ schemas: { where: (schema) => schema.transform(() => ({})) } });
        await runtime.start();
        expect((await runtime.hono.request('/api/projects/1', jsonRequest('PATCH', { name: 'Changed' }))).status).toBe(
            204,
        );
        expect(backend.update.mock.lastCall?.[0].filters).toEqual([{ id: 1 }, { ownerId: { equals: 'alice' } }]);
        await runtime.shutdown();
    });

    it('returns 404 for empty scoped item matches and redacts invalid database results', async () => {
        const { runtime, backend, onError } = fixture();
        await runtime.start();
        backend.all.mockResolvedValueOnce([]);
        expect((await runtime.hono.request('/api/projects/1')).status).toBe(404);
        backend.update.mockResolvedValueOnce(0);
        expect((await runtime.hono.request('/api/projects/1', jsonRequest('PATCH', { name: 'Changed' }))).status).toBe(
            404,
        );
        backend.delete.mockResolvedValueOnce(0);
        expect((await runtime.hono.request('/api/projects/1', { method: 'DELETE' })).status).toBe(404);
        backend.all.mockResolvedValueOnce([{ privateSecret: 'database-password' }]);
        const invalid = await runtime.hono.request('/api/projects');
        expect(invalid.status).toBe(500);
        expect(await invalid.json()).toEqual({
            error: { code: 'QUERY_RESULT_INVALID', message: 'Internal server error.' },
        });
        expect(onError.mock.lastCall?.[0]).toMatchObject({ cause: expect.any(z.ZodError) });
        backend.create.mockResolvedValueOnce({ privateSecret: 'database-password' });
        expect(
            (
                await runtime.hono.request(
                    '/api/projects',
                    jsonRequest('POST', { name: 'New', ownerId: 'alice', createdAt: JSON_ROW.createdAt, budget: '42' }),
                )
            ).status,
        ).toBe(500);
        await runtime.shutdown();
    });
});

describe('Generated OpenAPI and bootstrap', () => {
    it('serves the same enabled operations, JSON date/bigint schemas and error contracts', async () => {
        const { runtime } = fixture();
        expect(() => runtime.getOpenApiDocument()).toThrow();
        await runtime.start();
        const document = runtime.getOpenApiDocument();
        expect(document.openapi).toBe('3.1.0');
        expect(Object.keys(document.paths ?? {})).toEqual(['/api/projects', '/api/projects/{id}']);
        expect(Object.keys(document.paths?.['/api/projects'] ?? {})).toEqual(['get', 'post']);
        expect(Object.keys(document.paths?.['/api/projects/{id}'] ?? {})).toEqual(['get', 'patch', 'delete']);
        expect(JSON.stringify(document)).toContain('"format":"date-time"');
        expect(JSON.stringify(document)).toContain('Signed 64-bit integer');
        expect(document.paths?.['/api/projects/{id}']?.patch?.responses?.['204']).not.toHaveProperty('content');
        expect(await (await runtime.hono.request('/api/openapi.json')).json()).toEqual(document);
        document.paths = {};
        expect(runtime.getOpenApiDocument().paths).not.toEqual({});
        await runtime.shutdown();
    });

    it('fails unsupported primary keys before ready hooks or traffic and rolls back configured apps', async () => {
        const { runtime, app, shutdown } = fixture({
            fields: FIELDS.map((candidate) => ({ ...candidate, primaryKey: false })),
        });
        await expect(runtime.start()).rejects.toMatchObject({ code: 'HTTP_API_PRIMARY_KEY_INVALID' });
        expect(runtime.state).toBe('failed');
        expect(app.state).toBe('failed');
        expect(shutdown).toHaveBeenCalledOnce();
        expect((await runtime.hono.request('/api/projects')).status).toBe(503);
        await runtime.shutdown();
        expect(shutdown).toHaveBeenCalledOnce();
    });

    it('allows list-only resources without a primary key and rejects manual route conflicts', async () => {
        const list = fixture({
            api: { list: true },
            fields: FIELDS.map((candidate) => ({ ...candidate, primaryKey: false })),
        });
        await list.runtime.start();
        expect((await list.runtime.hono.request('/api/projects')).status).toBe(200);
        await list.runtime.shutdown();
        const conflict = fixture();
        conflict.runtime.hono.get('/api/projects', (context) => context.text('manual bypass'));
        await expect(conflict.runtime.start()).rejects.toMatchObject({ code: 'HTTP_API_ROUTE_CONFLICT' });
        expect(conflict.shutdown).toHaveBeenCalledOnce();
        await conflict.runtime.shutdown();
    });

    it('rejects exposing primary-key updates in composed schemas', async () => {
        const { runtime } = fixture({ schemas: { update: (schema) => schema.extend({ id: z.number().optional() }) } });
        await expect(runtime.start()).rejects.toMatchObject({ code: 'HTTP_API_SCHEMA_INVALID' });
        await runtime.shutdown();
    });

    it('rejects composed schemas that expose relation writes', async () => {
        const { runtime } = fixture({
            relations: [
                {
                    name: 'owner',
                    target: 'User',
                    cardinality: 'one',
                    nullable: false,
                    localFields: ['ownerId'],
                    targetFields: ['id'],
                },
            ],
            schemas: {
                create: (schema) => schema.extend({ owner: z.object({ create: z.object({ name: z.string() }) }) }),
            },
        });
        await expect(runtime.start()).rejects.toMatchObject({ code: 'HTTP_API_SCHEMA_INVALID' });
        await runtime.shutdown();
    });

    it('rejects an unrepresentable OpenAPI schema before mounting public routes', async () => {
        const { runtime, shutdown } = fixture({
            schemas: {
                read: (schema) => schema.extend({ name: z.custom<string>((value) => typeof value === 'string') }),
            },
        });
        await expect(runtime.start()).rejects.toMatchObject({ code: 'HTTP_API_SCHEMA_INVALID' });
        expect(runtime.hono.routes.some((route) => route.path === '/api/projects')).toBe(false);
        expect(shutdown).toHaveBeenCalledOnce();
        await runtime.shutdown();
    });

    it.each(['/api/projects/:slug', '/api/:resource', '/api/*'])(
        'rejects overlapping manual route %s before traffic',
        async (path) => {
            const { runtime, shutdown } = fixture();
            runtime.hono.get(path, (context) => context.text('manual'));
            await expect(runtime.start()).rejects.toMatchObject({ code: 'HTTP_API_ROUTE_CONFLICT' });
            expect(shutdown).toHaveBeenCalledOnce();
            await runtime.shutdown();
        },
    );

    it('rejects ambiguous model slugs atomically', async () => {
        const names = ['Project', 'project'];
        const models = names.map((name) =>
            generateModelSchemas({
                identity: name,
                name,
                namespace: 'public',
                provider: 'postgresql',
                relations: [],
                fields: FIELDS,
            }),
        );
        const shutdown = vi.fn();
        const app = defineApplication({
            apps: [{ name: 'projects', shutdown }],
            database: { kind: 'prisma', provider: 'postgresql', connection: 'unused' },
            resources: names.map((model) => defineResource({ model, api: { list: true } })),
            resourceModels: models,
        });
        const runtime = createHonoRuntime({ application: app });
        await expect(runtime.start()).rejects.toMatchObject({ code: 'HTTP_API_ROUTE_CONFLICT' });
        expect(runtime.hono.routes.some((route) => route.path === '/api/projects')).toBe(false);
        expect(shutdown).toHaveBeenCalledOnce();
        await runtime.shutdown();
    });

    it('aggregates API bootstrap and application rollback failures without retrying hooks', async () => {
        const { runtime, shutdown } = fixture({
            fields: FIELDS.map((candidate) => ({ ...candidate, primaryKey: false })),
        });
        shutdown.mockImplementation(() => {
            throw new Error('private cleanup failure');
        });
        await expect(runtime.start()).rejects.toMatchObject({
            code: 'APPLICATION_START_FAILED',
            cause: expect.any(AggregateError),
        });
        expect(runtime.state).toBe('failed');
        await runtime.shutdown();
        expect(shutdown).toHaveBeenCalledOnce();
    });
});
