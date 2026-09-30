import { defineAuth } from '@nestrum/auth';
import type {
    AdminActionContext,
    AuthenticationDefinition,
    FieldMetadata,
    ModelMetadata,
    PolicyDefinition,
    QuerySpec,
    ResourceSchemaComposers,
} from '@nestrum/core';
import { allow, defineApplication, defineResource, deny, eq } from '@nestrum/core';
import { createHonoRuntime } from '@nestrum/hono';
import { generateModelSchemas } from '@nestrum/zod';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { storage } from '../../auth/tests/fixtures.js';
import type { AdminOptions, AdminResourceConfiguration } from '../src/index.js';
import { defineAdmin } from '../src/index.js';

const BASE_URL = 'http://localhost:3000';
const ROW = { id: 1, name: 'One', ownerId: 'alice', createdAt: new Date('2026-01-01T00:00:00Z'), budget: 42n };
const WIRE_ROW = { ...ROW, createdAt: ROW.createdAt.toISOString(), budget: '42' };
const ACCESS: PolicyDefinition = { resource: 'admin.access', actions: { access: { authorize: () => allow() } } };
const RESOURCE_POLICY: PolicyDefinition = {
    resource: 'Project',
    actions: {
        read: { scope: ({ subject }) => eq('ownerId', subject.id as string) },
        create: { object: ({ subject, resource }) => (resource?.ownerId === subject.id ? allow() : deny('NOT_OWNER')) },
        update: { scope: ({ subject }) => eq('ownerId', subject.id as string) },
        delete: { scope: ({ subject }) => eq('ownerId', subject.id as string) },
        archive: { authorize: () => allow() },
    },
};

function field(name: string, kind: FieldMetadata['kind'] = 'string'): FieldMetadata {
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
    };
}
const METADATA: ModelMetadata = {
    name: 'Project',
    identity: 'Project',
    provider: 'postgresql',
    namespace: 'public',
    relations: [],
    fields: [
        field('id', 'integer'),
        field('name'),
        field('ownerId'),
        field('createdAt', 'date'),
        field('budget', 'bigint'),
    ],
};
const CONFIGURATION: AdminResourceConfiguration = {
    listDisplay: ['id', 'name'],
    actions: { archive: { label: 'Archive' }, unknown: {} },
};

function fixture(
    options: {
        policies?: readonly PolicyDefinition[];
        admin?: AdminOptions;
        configuration?: AdminResourceConfiguration;
        auth?: AuthenticationDefinition;
        metadata?: ModelMetadata;
        schemas?: ResourceSchemaComposers;
        configureRegistration?: boolean;
    } = {},
) {
    const metadata = options.metadata ?? METADATA;
    const resource = defineResource({
        model: metadata.name,
        api: false,
        ...(options.schemas ? { schemas: options.schemas } : {}),
    });
    const admin = defineAdmin(options.admin);
    const register = () => {
        admin.register(resource, options.configuration ?? CONFIGURATION);
    };
    if (!options.configureRegistration) {
        register();
    }
    const getSession = vi.fn(async (request: Request) =>
        request.headers.get('cookie') === 'session=valid'
            ? {
                  user: { id: 'alice', twoFactorEnabled: true, updatedAt: new Date(0) },
                  session: {
                      id: 'session',
                      userId: 'alice',
                      createdAt: new Date(),
                      expiresAt: new Date(Date.now() + 60_000),
                  },
              }
            : null,
    );
    const auth: AuthenticationDefinition = options.auth ?? {
        kind: 'better-auth',
        protectedModels: [],
        createApp: () => ({ name: 'test.auth' }),
        initialize: async () => ({
            basePath: '/api/auth',
            handle: async () => new Response(null, { status: 404 }),
            users: {
                list: async () => ({ users: [], total: 0, limit: 25, offset: 0 }),
                setRole: async () => {
                    throw new Error('unused');
                },
            },
            apiKeys: {
                authenticate: async () => null,
                create: async () => {
                    throw new Error('unused');
                },
                list: async () => ({ keys: [], total: 0, limit: 25, offset: 0 }),
                revoke: async () => {
                    throw new Error('unused');
                },
                rotate: async () => {
                    throw new Error('unused');
                },
            },
            createAdministrator: async () => {
                throw new Error('unused');
            },
            getSession,
            resolveSubject: async (request) =>
                (await getSession(request)) ? { id: 'alice', anonymous: false } : { anonymous: true },
        }),
    };
    const backend = {
        raw: {},
        all: vi.fn(async (_query: QuerySpec) => [{ ...ROW }]),
        count: vi.fn(async () => 1),
        create: vi.fn(async (data: object) => ({ ...ROW, ...data })),
        update: vi.fn(async () => 1),
        delete: vi.fn(async () => 1),
    };
    const application = defineApplication({
        apps: [{ name: 'projects', ...(options.configureRegistration ? { configure: register } : {}) }],
        database: { kind: 'prisma', provider: 'postgresql', connection: 'unused' },
        auth,
        admin,
        resources: [resource],
        resourceModels: [{ ...generateModelSchemas(metadata), queryBackend: backend }],
        policies: options.policies ?? [ACCESS, { ...RESOURCE_POLICY, resource: metadata.identity }],
    });
    const onError = vi.fn();
    const runtime = createHonoRuntime({ application, onError });
    const slug = 'projects';
    function request(path: string, init: RequestInit = {}, authenticated = true) {
        const headers = new Headers(init.headers);
        if (authenticated && !headers.has('cookie')) {
            headers.set('cookie', 'session=valid');
        }

        return runtime.fetch(new Request(`${BASE_URL}${path}`, { ...init, headers }));
    }

    return { runtime, application, admin, resource, backend, request, onError, slug };
}

function body(method: string, value: unknown): RequestInit {
    return { method, headers: { 'content-type': 'application/json', origin: BASE_URL }, body: JSON.stringify(value) };
}

describe('Private admin backend', () => {
    it('discovers metadata without a database query and supports registration during configure', async () => {
        const { runtime, request, backend, admin, resource } = fixture({
            configureRegistration: true,
            configuration: {
                ...CONFIGURATION,
                fields: { ownerId: { hidden: true }, name: { label: 'Project name' }, budget: { readOnly: true } },
            },
        });
        await runtime.start();
        const response = await request('/__admin/resources');
        expect(response.status).toBe(200);
        const metadata = await response.json();
        expect(metadata).toMatchObject([
            {
                identity: 'Project',
                slug: 'projects',
                listDisplay: ['id', 'name'],
                primaryKey: 'id',
                capabilities: { list: true, retrieve: true, create: true, update: true, delete: true },
                actions: [{ name: 'archive', label: 'Archive' }],
            },
        ]);
        expect(metadata[0].fields.map((value: { name: string }) => value.name)).not.toContain('ownerId');
        expect(metadata[0].fields).toContainEqual(
            expect.objectContaining({ name: 'name', label: 'Project name', required: true }),
        );
        expect(metadata[0].fields).toContainEqual(
            expect.objectContaining({ name: 'budget', creatable: false, updatable: false, readOnly: true }),
        );
        expect(await (await request('/__admin/resources/projects')).json()).toEqual(metadata[0]);
        expect(backend.all).not.toHaveBeenCalled();
        expect(() => admin.register(resource, CONFIGURATION)).toThrow(/closed/);
        expect((await request('/__admin/projects/1', body('PATCH', { budget: '5' }))).status).toBe(400);
        expect(backend.update).not.toHaveBeenCalled();
        await runtime.shutdown();
    });

    it('uses ABAC scoped CRUD for api:false resources, typed scalar transport and empty 204 responses', async () => {
        const { runtime, request, backend } = fixture();
        await runtime.start();
        expect((await request('/api/projects')).status).toBe(404);
        expect(runtime.getOpenApiDocument().paths).toEqual({});
        expect(await (await request('/__admin/projects?limit=2&orderBy=-name')).json()).toEqual({ rows: [WIRE_ROW] });
        expect(backend.all).toHaveBeenLastCalledWith({
            filters: [{ ownerId: { equals: 'alice' } }],
            orderBy: [{ field: 'name', direction: 'desc' }],
            limit: 2,
        });
        expect(await (await request('/__admin/projects/1')).json()).toEqual(WIRE_ROW);
        expect(backend.all).toHaveBeenLastCalledWith({
            filters: [{ id: 1 }, { ownerId: { equals: 'alice' } }],
            orderBy: [],
            limit: 2,
        });
        const { id: _id, ...input } = WIRE_ROW;
        const created = await request('/__admin/projects', body('POST', input));
        expect(created.status).toBe(201);
        expect(await created.json()).toEqual(WIRE_ROW);
        expect(backend.create).toHaveBeenLastCalledWith({ ...input, createdAt: ROW.createdAt, budget: 42n });
        const updated = await request('/__admin/projects/1', body('PATCH', { name: 'Changed' }));
        expect(updated.status).toBe(204);
        expect(await updated.text()).toBe('');
        expect(backend.update).toHaveBeenCalledWith(
            { filters: [{ id: 1 }, { ownerId: { equals: 'alice' } }], orderBy: [] },
            { name: 'Changed' },
        );
        const deleted = await request('/__admin/projects/1', { method: 'DELETE' });
        expect(deleted.status).toBe(204);
        expect(await deleted.text()).toBe('');
        expect(backend.delete).toHaveBeenCalledWith({
            filters: [{ id: 1 }, { ownerId: { equals: 'alice' } }],
            orderBy: [],
        });
        await runtime.shutdown();
    });

    it.each([undefined, 'session=forged', 'session=expired'])(
        'requires a live session even when runtime subject is overridden: %s',
        async (cookie) => {
            const { runtime, application, backend } = fixture();
            const overridden = createHonoRuntime({
                application,
                resolveSubject: () => ({ id: 'alice', staff: true }),
                onError: vi.fn(),
            });
            await overridden.start();
            const response = await overridden.fetch(
                new Request(`${BASE_URL}/__admin/resources`, { headers: cookie ? { cookie } : {} }),
            );
            expect(response.status).toBe(401);
            expect(backend.all).not.toHaveBeenCalled();
            await overridden.shutdown();
            expect(runtime.state).toBe('created');
        },
    );

    it.each([
        { policies: [] },
        { policies: [{ resource: 'admin.access', actions: { access: { authorize: () => deny('NOT_STAFF') } } }] },
    ])('default-denies admin access before data access', async ({ policies }) => {
        const { runtime, request, backend } = fixture({ policies });
        await runtime.start();
        expect((await request('/__admin/resources')).status).toBe(403);
        expect((await request('/__admin/projects')).status).toBe(403);
        expect(backend.all).not.toHaveBeenCalled();
        await runtime.shutdown();
    });

    it('hides unauthorized metadata and denies resource operations and custom actions', async () => {
        const { runtime, request, backend } = fixture({ policies: [ACCESS] });
        await runtime.start();
        expect(await (await request('/__admin/resources')).json()).toEqual([]);
        expect((await request('/__admin/resources/projects')).status).toBe(404);
        expect((await request('/__admin/projects')).status).toBe(403);
        expect((await request('/__admin/projects/1', body('PATCH', { name: 'Changed' }))).status).toBe(403);
        expect((await request('/__admin/projects/1', { method: 'DELETE' })).status).toBe(403);
        const { id: _id, ...input } = WIRE_ROW;
        expect((await request('/__admin/projects', body('POST', input))).status).toBe(403);
        expect((await request('/__admin/projects/1/actions/archive', { method: 'POST' })).status).toBe(403);
        expect(backend.all).not.toHaveBeenCalled();
        expect(backend.create).not.toHaveBeenCalled();
        expect(backend.update).not.toHaveBeenCalled();
        expect(backend.delete).not.toHaveBeenCalled();
        await runtime.shutdown();
    });

    it('authorizes unknown routes and the base path before revealing route metadata', async () => {
        const { runtime, request } = fixture();
        await runtime.start();
        for (const path of ['/__admin', '/__admin/missing/nested/path', '/__admin/resources']) {
            expect((await request(path, {}, false)).status).toBe(401);
        }
        expect((await request('/__admin/missing/nested/path')).status).toBe(404);
        await runtime.shutdown();
    });

    it('checks custom action object grants and hides unknown action metadata', async () => {
        const handler = vi.fn();
        const { runtime, request } = fixture({
            configuration: { ...CONFIGURATION, actions: { archive: { handler } } },
            policies: [
                ACCESS,
                {
                    resource: 'Project',
                    actions: {
                        read: { authorize: () => allow() },
                        archive: { object: () => deny('NOT_ALLOWED') },
                    },
                },
            ],
        });
        await runtime.start();
        expect((await request('/__admin/projects/1/actions/archive', { method: 'POST' })).status).toBe(404);
        expect(handler).not.toHaveBeenCalled();
        const metadata = await (await request('/__admin/resources/projects')).json();
        expect(metadata.actions.map((action: { name: string }) => action.name)).toEqual(['archive']);
        expect(metadata.capabilities.update).toBe(false);
        await runtime.shutdown();
    });

    it('executes known actions under their ordinary ABAC action and scopes handler QuerySets to the target', async () => {
        const handler = vi.fn(async (context: AdminActionContext) => {
            expect(context.subject.id).toBe('alice');
            expect(context.record.id).toBe(1);
            expect(Object.isFrozen(context.record)).toBe(true);
            expect(context.environment.method).toBe('POST');
            return context.objects.update({ name: 'Archived' });
        });
        const { runtime, request, backend } = fixture({
            configuration: {
                ...CONFIGURATION,
                fields: { name: { widget: 'textarea' } },
                actions: { archive: { label: 'Archive project', handler } },
            },
            policies: [
                ACCESS,
                {
                    ...RESOURCE_POLICY,
                    actions: {
                        ...RESOURCE_POLICY.actions,
                        archive: { operations: ['update'], scope: () => eq('ownerId', 'alice') },
                    },
                },
            ],
        });
        await runtime.start();
        const metadata = await (await request('/__admin/resources/projects')).json();
        expect(metadata.fields.find((value: { name: string }) => value.name === 'name').widget).toBe('textarea');
        expect(metadata.actions).toEqual([{ name: 'archive', label: 'Archive project' }]);
        expect(await (await request('/__admin/projects/1/actions/archive', body('POST', {}))).json()).toEqual({
            result: 1,
        });
        expect(handler).toHaveBeenCalledOnce();
        expect(backend.update).toHaveBeenCalledWith(
            expect.objectContaining({
                filters: expect.arrayContaining([{ id: 1 }, { ownerId: { equals: 'alice' } }]),
            }),
            { name: 'Archived' },
        );
        await runtime.shutdown();
    });

    it('never executes denied, unknown, out-of-scope, or unauthenticated action handlers', async () => {
        const handler = vi.fn();
        const denied = fixture({
            configuration: { ...CONFIGURATION, actions: { archive: { handler } } },
            policies: [
                ACCESS,
                {
                    resource: 'Project',
                    actions: { read: { authorize: () => allow() }, archive: { authorize: () => deny('NO_ARCHIVE') } },
                },
            ],
        });
        await denied.runtime.start();
        expect((await denied.request('/__admin/projects/1/actions/archive', body('POST', {}))).status).toBe(403);
        expect((await denied.request('/__admin/projects/1/actions/missing', body('POST', {}))).status).toBe(404);
        expect((await denied.request('/__admin/projects/1/actions/archive', body('POST', {}), false)).status).toBe(401);
        expect(handler).not.toHaveBeenCalled();
        expect(denied.backend.all).not.toHaveBeenCalled();
        await denied.runtime.shutdown();
        const scoped = fixture({
            configuration: { ...CONFIGURATION, actions: { archive: { handler } } },
            policies: [
                ACCESS,
                {
                    ...RESOURCE_POLICY,
                    actions: { ...RESOURCE_POLICY.actions, archive: { scope: () => eq('ownerId', 'bob') } },
                },
            ],
        });
        scoped.backend.all.mockImplementation(async () => []);
        await scoped.runtime.start();
        expect((await scoped.request('/__admin/projects/1/actions/archive', body('POST', {}))).status).toBe(404);
        expect(handler).not.toHaveBeenCalled();
        expect(scoped.backend.all).toHaveBeenCalledWith(
            expect.objectContaining({
                filters: expect.arrayContaining([{ ownerId: { equals: 'alice' } }, { ownerId: { equals: 'bob' } }]),
            }),
        );
        await scoped.runtime.shutdown();
    });

    it('validates action input before execution and authorizes parsed input, while encoding native results', async () => {
        const schema = z
            .object({
                reason: z
                    .string()
                    .min(3)
                    .transform((value) => value.toUpperCase()),
            })
            .strict();
        const handler = vi.fn(async (context: AdminActionContext) => {
            expect(context.input).toEqual({ reason: 'READY' });
            return { count: 42n, at: ROW.createdAt };
        });
        const setup = fixture({
            configuration: { ...CONFIGURATION, actions: { archive: { input: schema, handler } } },
            policies: [
                ACCESS,
                {
                    resource: 'Project',
                    actions: {
                        read: { authorize: () => allow() },
                        archive: {
                            authorize: ({ input }) => (input?.reason === 'READY' ? allow() : deny('BAD_REASON')),
                        },
                    },
                },
            ],
        });
        await setup.runtime.start();
        expect((await setup.request('/__admin/projects/1/actions/archive', body('POST', { reason: 'x' }))).status).toBe(
            400,
        );
        expect(handler).not.toHaveBeenCalled();
        expect(
            await (
                await setup.request('/__admin/projects/1/actions/archive', body('POST', { reason: 'ready' }))
            ).json(),
        ).toEqual({ result: { count: '42', at: ROW.createdAt.toISOString() } });
        expect(handler).toHaveBeenCalledOnce();
        await setup.runtime.shutdown();
    });

    it('preserves trusted action scope predicates when user where transforms would broaden them', async () => {
        const handler = vi.fn();
        const setup = fixture({
            schemas: {
                where: (schema) =>
                    schema.transform((value) => ({
                        ...(value as Record<string, unknown>),
                        ownerId: { equals: 'alice' },
                    })),
            },
            configuration: { ...CONFIGURATION, actions: { archive: { handler } } },
            policies: [
                ACCESS,
                {
                    ...RESOURCE_POLICY,
                    actions: { ...RESOURCE_POLICY.actions, archive: { scope: () => eq('ownerId', 'bob') } },
                },
            ],
        });
        setup.backend.all.mockImplementation(async () => []);
        await setup.runtime.start();
        expect((await setup.request('/__admin/projects/1/actions/archive', body('POST', {}))).status).toBe(404);
        expect(setup.backend.all).toHaveBeenCalledWith(
            expect.objectContaining({ filters: expect.arrayContaining([{ ownerId: { equals: 'bob' } }]) }),
        );
        expect(handler).not.toHaveBeenCalled();
        await setup.runtime.shutdown();
    });

    it.each([
        { fields: { name: { widget: '../remote' } } },
        { actions: { 'unsafe/name': {} } },
        { actions: { archive: { handler: 'invalid' } } },
        { actions: { archive: { input: {} } } },
    ])('rejects invalid widget/action registration: %j', (configuration) => {
        expect(() =>
            fixture({ configuration: { ...CONFIGURATION, ...configuration } as AdminResourceConfiguration }),
        ).toThrow();
    });

    it.each([
        { origin: 'https://evil.example' },
        { origin: 'null' },
        { origin: 'invalid' },
        { referer: 'invalid' },
        { referer: 'https://evil.example/page' },
        { 'sec-fetch-site': 'cross-site' },
    ])('denies foreign and opaque browser origins: %j', async (headers) => {
        const { runtime, request, backend } = fixture();
        await runtime.start();
        expect((await request('/__admin/projects', { headers })).status).toBe(403);
        expect(backend.all).not.toHaveBeenCalled();
        await runtime.shutdown();
    });

    it('allows same origin, originless clients, explicit allowed origins and credentialed preflight', async () => {
        const { runtime, request, onError } = fixture({ admin: { allowedOrigins: ['https://admin.example/'] } });
        await runtime.start();
        for (const headers of [
            {},
            { origin: BASE_URL },
            { referer: `${BASE_URL}/admin` },
            { origin: 'https://admin.example' },
        ]) {
            const response = await request('/__admin/resources', { headers });
            expect(response.status).toBe(200);
            if ('origin' in headers) {
                expect(response.headers.get('access-control-allow-origin')).toBe(headers.origin);
                expect(response.headers.get('access-control-allow-credentials')).toBe('true');
            }
        }
        const preflight = await request(
            '/__admin/projects',
            {
                method: 'OPTIONS',
                headers: {
                    origin: 'https://admin.example',
                    'access-control-request-method': 'PATCH',
                    'access-control-request-headers': 'content-type',
                },
            },
            false,
        );
        expect(preflight.status).toBe(204);
        expect(preflight.headers.get('access-control-allow-origin')).toBe('https://admin.example');
        const invalid = await request('/__admin/projects?limit=101', { headers: { origin: 'https://admin.example' } });
        expect(invalid.status).toBe(400);
        expect(invalid.headers.get('access-control-allow-origin')).toBe('https://admin.example');
        expect(onError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ phase: 'request' }));
        expect(
            (
                await request(
                    '/__admin/projects',
                    { method: 'OPTIONS', headers: { origin: 'https://evil.example' } },
                    false,
                )
            ).status,
        ).toBe(403);
        await runtime.shutdown();
    });

    it.each([
        '/__admin/projects?limit=101',
        '/__admin/projects?limit=-1',
        '/__admin/projects?limit=2&limit=3',
        '/__admin/projects?filter=x',
        '/__admin/projects/1?limit=1',
    ])('rejects malformed requests before database access: %s', async (path) => {
        const { runtime, request, backend } = fixture();
        await runtime.start();
        expect((await request(path)).status).toBe(400);
        expect(backend.all).not.toHaveBeenCalled();
        await runtime.shutdown();
    });

    it('rejects malformed body/IDs, unknown fields, denied creates and unmatched mutations', async () => {
        const { runtime, request, backend } = fixture();
        await runtime.start();
        expect((await request('/__admin/projects', { method: 'POST', body: '{}' })).status).toBe(415);
        expect((await request('/__admin/projects', { ...body('POST', {}), body: '{' })).status).toBe(400);
        expect((await request('/__admin/projects/1', body('PATCH', {}))).status).toBe(400);
        expect((await request('/__admin/projects/1', body('PATCH', { unknown: true }))).status).toBe(400);
        expect((await request('/__admin/projects/bad')).status).toBe(400);
        const { id: _id, ...input } = WIRE_ROW;
        expect((await request('/__admin/projects', body('POST', { ...input, ownerId: 'bob' }))).status).toBe(403);
        expect(backend.create).not.toHaveBeenCalled();
        backend.update.mockResolvedValueOnce(0);
        expect((await request('/__admin/projects/1', body('PATCH', { name: 'Changed' }))).status).toBe(404);
        backend.delete.mockResolvedValueOnce(2);
        expect((await request('/__admin/projects/1', { method: 'DELETE' })).status).toBe(500);
        expect((await request('/__admin/missing')).status).toBe(404);
        expect((await request('/__admin/projects/1/actions/nope', { method: 'POST' })).status).toBe(404);
        expect((await request('/__admin/projects/1/actions/archive', { method: 'POST' })).status).toBe(501);
        await runtime.shutdown();
    });

    it('fails closed on route conflicts, invalid fields and unusable primary keys', async () => {
        const conflict = fixture();
        conflict.runtime.hono.get('/__admin/resources', (context) => context.text('bypass'));
        await expect(conflict.runtime.start()).rejects.toMatchObject({ code: 'ADMIN_ROUTE_CONFLICT' });
        expect(conflict.runtime.state).toBe('failed');
        const invalid = fixture({ configuration: { listDisplay: ['missing'] } });
        await expect(invalid.runtime.start()).rejects.toMatchObject({ code: 'ADMIN_FIELD_UNKNOWN' });
        const keyless = fixture({
            metadata: { ...METADATA, fields: METADATA.fields.map((value) => ({ ...value, primaryKey: false })) },
        });
        await expect(keyless.runtime.start()).rejects.toMatchObject({ code: 'HTTP_API_PRIMARY_KEY_INVALID' });
    });

    it('validates origins, duplicate identities/slugs, hidden list fields and built-in action names', async () => {
        expect(() => defineAdmin({ allowedOrigins: ['https://example.com/path'] })).toThrow();
        const admin = defineAdmin();
        const resource = defineResource({ model: 'Project' });
        admin.register(resource, CONFIGURATION);
        expect(() => admin.register(resource, CONFIGURATION)).toThrow(/twice/);
        expect(() => admin.register(defineResource({ model: 'project' }), CONFIGURATION)).toThrow(/more than once/);
        expect(() => defineAdmin().register(resource, { listDisplay: ['id'], actions: { update: {} } })).toThrow(
            /built-in/,
        );
        expect(() =>
            defineApplication({
                apps: [],
                database: { kind: 'prisma', provider: 'postgresql', connection: 'unused' },
                admin,
            }),
        ).toThrow(/authentication/);
        const hidden = fixture({ configuration: { listDisplay: ['name'], fields: { name: { hidden: true } } } });
        await expect(hidden.runtime.start()).rejects.toMatchObject({ code: 'ADMIN_REGISTRATION_INVALID' });
    });

    it('uses a real Better Auth session and SubjectFactory, rejects expired sessions and logout', async () => {
        const memory = storage();
        const { runtime, request, application } = fixture({
            admin: { security: { twoFactor: { required: false } } },
            auth: defineAuth({
                baseURL: BASE_URL,
                secret: 'nestrum-admin-test-secret-longer-than-thirty-two-characters',
                prisma: () => memory.binding,
                subjectFactory: ({ user }) => ({ id: user.id, staff: user.email === 'staff@example.com' }),
            }),
            policies: [
                {
                    resource: 'admin.access',
                    actions: { access: { authorize: ({ subject }) => (subject.staff ? allow() : deny('NOT_STAFF')) } },
                },
                RESOURCE_POLICY,
            ],
        });
        await runtime.start();
        expect((await request('/__admin/resources', {}, false)).status).toBe(401);
        const signup = await request(
            '/api/auth/sign-up/email',
            body('POST', { name: 'Staff', email: 'staff@example.com', password: 'a-valid-password-123' }),
            false,
        );
        expect(signup.status).toBe(200);
        const cookie = signup.headers
            .getSetCookie()
            .map((value) => value.split(';')[0])
            .join('; ');
        expect((await request('/__admin/resources', { headers: { cookie } })).status).toBe(200);
        const member = await request(
            '/api/auth/sign-up/email',
            body('POST', { name: 'Member', email: 'member@example.com', password: 'a-valid-password-123' }),
            false,
        );
        const memberCookie = member.headers
            .getSetCookie()
            .map((value) => value.split(';')[0])
            .join('; ');
        expect((await request('/__admin/resources', { headers: { cookie: memberCookie } })).status).toBe(403);
        expect(
            await application.auth!.resolveSubject(
                new Request(`${BASE_URL}/__admin/resources`, { headers: { cookie } }),
            ),
        ).toMatchObject({ staff: true });
        memory.records.Session[0]!.expiresAt = new Date(0).toISOString();
        expect((await request('/__admin/resources', { headers: { cookie } })).status).toBe(401);
        const login = await request(
            '/api/auth/sign-in/email',
            body('POST', { email: 'staff@example.com', password: 'a-valid-password-123' }),
            false,
        );
        const loginCookie = login.headers
            .getSetCookie()
            .map((value) => value.split(';')[0])
            .join('; ');
        expect((await request('/__admin/resources', { headers: { cookie: loginCookie } })).status).toBe(200);
        expect(
            (
                await request('/api/auth/sign-out', {
                    ...body('POST', {}),
                    headers: { 'content-type': 'application/json', origin: BASE_URL, cookie: loginCookie },
                })
            ).status,
        ).toBe(200);
        expect((await request('/__admin/resources', { headers: { cookie: loginCookie } })).status).toBe(401);
        await runtime.shutdown();
    });
});
