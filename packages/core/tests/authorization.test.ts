import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { FilterExpression, ModelMetadata, PolicyDefinition, QueryBackend, QuerySpec } from '../src/index.js';
import {
    AuthorizationEngine,
    AuthorizationError,
    allow,
    and,
    compilePolicyScope,
    defineApp,
    defineApplication,
    definePolicy,
    deny,
    eq,
    inFilter,
    isNull,
    neq,
    not,
    notIn,
    or,
    PolicyError,
    QuerySet,
} from '../src/index.js';

type Project = { id: number; ownerId: string; status: string; note: string | null };
const ROW: Project = { id: 1, ownerId: 'alice', status: 'active', note: null };
const READ = z.strictObject({ id: z.number(), ownerId: z.string(), status: z.string(), note: z.string().nullable() });
const METADATA = {
    identity: 'Project',
    name: 'Project',
    provider: 'postgresql',
    namespace: 'public',
    relations: [],
    fields: Object.keys(ROW).map((name) => ({
        name,
        codec: 'pg/text@1',
        kind: 'string',
        array: false,
        nullable: name === 'note',
        optional: false,
        primaryKey: name === 'id',
        hasCreateDefault: name === 'id',
        hasUpdateDefault: false,
    })),
} as ModelMetadata;
const SCHEMAS = {
    model: READ,
    read: READ,
    create: READ.omit({ id: true }),
    update: READ.omit({ id: true }).partial(),
    where: z.record(z.string(), z.unknown()),
    orderBy: z.object({ id: z.enum(['asc', 'desc']).optional() }),
};
const OWNER_SCOPE = async ({ subject }: { subject: Readonly<Record<string, unknown>> }) =>
    eq('ownerId', subject.id as string);
const OWNER_POLICY: PolicyDefinition = {
    resource: 'Project',
    actions: {
        read: { scope: OWNER_SCOPE },
        update: { scope: OWNER_SCOPE },
        delete: { scope: OWNER_SCOPE },
        create: { object: ({ resource, subject }) => (resource?.ownerId === subject.id ? allow() : deny('NOT_OWNER')) },
        archive: { operations: ['update'], scope: OWNER_SCOPE },
    },
};

function fixture(policies: readonly PolicyDefinition[] = [OWNER_POLICY]) {
    const authorization = new AuthorizationEngine(policies);
    const backend = {
        raw: { bypass: true },
        all: vi.fn(async (_query: QuerySpec) => [ROW]),
        count: vi.fn(async (_query: QuerySpec) => 1),
        create: vi.fn(async (data: Omit<Project, 'id'>) => ({ ...data, id: 2 })),
        update: vi.fn(async (_query: QuerySpec, _data: Partial<Omit<Project, 'id'>>) => 1),
        delete: vi.fn(async (_query: QuerySpec) => 1),
    } satisfies QueryBackend<Project, Omit<Project, 'id'>, Partial<Omit<Project, 'id'>>, { bypass: boolean }>;
    const query = new QuerySet({ identity: 'Project', metadata: METADATA, schemas: SCHEMAS, authorization }, backend);

    return { query, backend, authorization };
}

describe('Default-deny ABAC', () => {
    it('requires authorization, including empty reads, and denies missing policies/actions before DB access', async () => {
        const { query, backend } = fixture([]);
        await expect(query.all()).rejects.toMatchObject({
            code: 'AUTHORIZATION_DENIED',
            reason: 'CONTEXT_REQUIRED',
            status: 403,
        });
        await expect(query.limit(0).exists()).rejects.toMatchObject({ reason: 'CONTEXT_REQUIRED' });
        await expect(query.authorizedFor({}, 'read').all()).rejects.toMatchObject({ reason: 'POLICY_MISSING' });
        const other = fixture();
        await expect(other.query.authorizedFor({}, 'publish').all()).rejects.toMatchObject({
            reason: 'ACTION_MISSING',
        });
        await expect(other.query.authorizedFor({}, 'toString').all()).rejects.toMatchObject({
            reason: 'ACTION_MISSING',
        });
        expect(backend.all).not.toHaveBeenCalled();
        expect(other.backend.all).not.toHaveBeenCalled();
    });

    it('resource denial takes precedence over action grants and arbitrary actions work', async () => {
        const check = vi.fn(() => allow());
        const engine = new AuthorizationEngine([
            {
                resource: 'Project',
                authorize: ({ resource }) => (resource === undefined ? deny('RESOURCE_DISABLED') : allow()),
                actions: { publish: { authorize: check } },
            },
        ]);
        expect(
            await engine.authorize({
                identity: 'Project',
                subject: {},
                action: 'publish',
                environment: {},
                resource: ROW,
            }),
        ).toEqual(deny('RESOURCE_DISABLED'));
        expect(check).not.toHaveBeenCalled();
        const inherited = Object.assign(
            Object.create({ authorize: () => deny('INHERITED_GUARD') }) as PolicyDefinition,
            { resource: 'Project', actions: { publish: { authorize: check } } },
        );
        expect(
            await new AuthorizationEngine([inherited]).authorize({
                identity: 'Project',
                subject: {},
                action: 'publish',
                environment: {},
            }),
        ).toEqual(deny('INHERITED_GUARD'));
        const grant = new AuthorizationEngine([
            {
                resource: 'admin',
                actions: {
                    'admin.access': {
                        authorize: async ({ environment }) => (environment.trusted ? allow() : deny('UNTRUSTED')),
                    },
                },
            },
        ]);
        expect(
            await grant.authorize({
                identity: 'admin',
                subject: {},
                action: 'admin.access',
                environment: { trusted: true },
            }),
        ).toEqual(allow());
        expect(
            await grant.authorize({ identity: 'admin', subject: {}, action: 'admin.access', environment: {} }),
        ).toEqual(deny('UNTRUSTED'));
    });

    it('does not grant empty actions, invalid decisions, or object-only actions without an object', async () => {
        const engine = new AuthorizationEngine([
            {
                resource: 'Project',
                actions: {
                    empty: {},
                    invalid: { authorize: (() => true) as never },
                    approve: { object: ({ resource }) => (resource?.status === 'active' ? allow() : deny('INACTIVE')) },
                },
            },
        ]);
        const context = { identity: 'Project', subject: {}, environment: {} };
        expect(await engine.authorize({ ...context, action: 'empty' })).toEqual(deny('ACTION_HAS_NO_GRANT'));
        expect(await engine.authorize({ ...context, action: 'invalid' })).toEqual(deny('INVALID_DECISION'));
        expect(await engine.authorize({ ...context, action: 'approve' })).toEqual(deny('RESOURCE_REQUIRED'));
        expect(await engine.authorize({ ...context, action: 'approve', resource: ROW })).toEqual(allow());
        expect(
            await engine.authorize({ ...context, action: 'approve', resource: { ...ROW, status: 'archived' } }),
        ).toEqual(deny('INACTIVE'));
    });

    it('scope alone cannot authorize a standalone object without a database query', async () => {
        const { authorization } = fixture();
        expect(
            await authorization.authorize({
                identity: 'Project',
                subject: { id: 'bob' },
                action: 'read',
                environment: {},
                resource: ROW,
            }),
        ).toEqual(deny('SCOPE_REQUIRES_QUERY'));
    });

    it('combines caller and manager predicates with fresh DB scopes and preserves subject/environment branches', async () => {
        const { query, backend } = fixture();
        const subject = { id: 'alice' };
        const branch = query.filter({ status: 'active' }).authorizedFor(subject, 'read');
        subject.id = 'bob';
        await branch.orderBy('-id').limit(5).all();
        expect(backend.all).toHaveBeenLastCalledWith({
            filters: [{ status: 'active' }, { ownerId: { equals: 'alice' } }],
            orderBy: [{ field: 'id', direction: 'desc' }],
            limit: 5,
        });
        await branch.authorizedFor({ id: 'bob' }, 'read').first();
        expect(backend.all.mock.lastCall![0].filters.at(-1)).toEqual({ ownerId: { equals: 'bob' } });
        await branch.all();
        expect(backend.all.mock.lastCall![0].filters.at(-1)).toEqual({ ownerId: { equals: 'alice' } });
        await expect(query.all()).rejects.toBeInstanceOf(AuthorizationError);
    });

    it('scopes count and bulk writes without fetching records; custom writes need an operation declaration', async () => {
        const { query, backend } = fixture();
        await query.authorizedFor({ id: 'alice' }, 'read').limit(1).count();
        expect(backend.count).toHaveBeenCalledWith({ filters: [{ ownerId: { equals: 'alice' } }], orderBy: [] });
        await query.authorizedFor({ id: 'alice' }, 'update').filter({ id: 1 }).update({ status: 'archived' });
        expect(backend.update).toHaveBeenCalledWith(
            { filters: [{ id: 1 }, { ownerId: { equals: 'alice' } }], orderBy: [] },
            { status: 'archived' },
        );
        await query.authorizedFor({ id: 'alice' }, 'archive').update({ status: 'archived' });
        await query.authorizedFor({ id: 'alice' }, 'delete').delete();
        expect(backend.delete).toHaveBeenCalledWith({ filters: [{ ownerId: { equals: 'alice' } }], orderBy: [] });
        await expect(query.authorizedFor({ id: 'alice' }, 'read').update({ status: 'archived' })).rejects.toMatchObject(
            { reason: 'ACTION_OPERATION_MISMATCH' },
        );
        expect(backend.all).not.toHaveBeenCalled();
    });

    it('fails the whole result on an object denial and never silently post-filters a list', async () => {
        const policy = {
            ...OWNER_POLICY,
            actions: {
                read: {
                    scope: OWNER_SCOPE,
                    object: ({ resource, subject }: Parameters<NonNullable<PolicyDefinition['authorize']>>[0]) =>
                        resource?.ownerId === subject.id ? allow() : deny('NOT_OWNER'),
                },
            },
        };
        const { query, backend } = fixture([policy]);
        backend.all.mockResolvedValue([ROW, { ...ROW, id: 2, ownerId: 'bob' }]);
        await expect(query.authorizedFor({ id: 'alice' }, 'read').all()).rejects.toMatchObject({ reason: 'NOT_OWNER' });
        await expect(query.authorizedFor({ id: 'alice' }, 'read').get()).rejects.toMatchObject({ reason: 'NOT_OWNER' });
        expect(backend.all.mock.lastCall![0].filters).toEqual([{ ownerId: { equals: 'alice' } }]);
    });

    it('rejects count/bulk terminals with object policies even when a scope or ID filter exists', async () => {
        const action = {
            scope: OWNER_SCOPE,
            object: () => deny('NOT_OWNER'),
            operations: ['read', 'count', 'update', 'delete'] as const,
        };
        const { query, backend } = fixture([{ resource: 'Project', actions: { review: action } }]);
        const secured = query.filter({ id: 1 }).authorizedFor({ id: 'alice' }, 'review');
        await expect(secured.count()).rejects.toMatchObject({ reason: 'OBJECT_CHECK_REQUIRES_OBJECT' });
        await expect(secured.update({ status: 'archived' })).rejects.toMatchObject({
            reason: 'OBJECT_CHECK_REQUIRES_OBJECT',
        });
        await expect(secured.delete()).rejects.toMatchObject({ reason: 'OBJECT_CHECK_REQUIRES_OBJECT' });
        expect(backend.count).not.toHaveBeenCalled();
        expect(backend.update).not.toHaveBeenCalled();
        expect(backend.delete).not.toHaveBeenCalled();
    });

    it('checks validated create input before effects and rejects collection-scoped create policies', async () => {
        const { query, backend } = fixture();
        const { id, ...data } = ROW;
        await expect(query.authorizedFor({ id: 'bob' }, 'create').create(data)).rejects.toMatchObject({
            reason: 'NOT_OWNER',
        });
        expect(backend.create).not.toHaveBeenCalled();
        expect(await query.authorizedFor({ id: 'alice' }, 'create').create(data)).toEqual({ ...data, id: 2 });
        const scoped = fixture([{ resource: 'Project', actions: { create: { scope: OWNER_SCOPE } } }]);
        await expect(scoped.query.authorizedFor({ id: 'alice' }, 'create').create(data)).rejects.toMatchObject({
            reason: 'CREATE_REQUIRES_EXPLICIT_CHECK',
        });
        expect(scoped.backend.create).not.toHaveBeenCalled();
    });

    it('preserves raw as an explicit unfiltered authorization bypass', () => {
        const { query, backend } = fixture([]);
        expect(query.raw()).toBe(backend.raw);
        expect(query.authorizedFor({}, 'missing').filter({ id: 1 }).raw()).toBe(backend.raw);
    });

    it('propagates policy failures without touching the database', async () => {
        const error = new Error('policy unavailable');
        const { query, backend } = fixture([
            {
                resource: 'Project',
                actions: {
                    read: {
                        authorize: () => {
                            throw error;
                        },
                    },
                },
            },
        ]);
        await expect(query.authorizedFor({}, 'read').all()).rejects.toBe(error);
        expect(backend.all).not.toHaveBeenCalled();
    });
});

describe('Provider-neutral scope AST', () => {
    it('compiles every helper into conjunctive/disjunctive Prisma predicates', () => {
        expect(
            compilePolicyScope(
                and(
                    eq('ownerId', 'alice'),
                    or(neq('status', 'archived'), inFilter('id', [1, 2])),
                    not(notIn('id', [3])),
                    isNull('note'),
                ),
                Object.keys(ROW),
            ),
        ).toEqual({
            AND: [
                { ownerId: { equals: 'alice' } },
                { OR: [{ status: { not: 'archived' } }, { id: { in: [1, 2] } }] },
                { NOT: { id: { notIn: [3] } } },
                { note: { equals: null } },
            ],
        });
        expect(Object.isFrozen(and(eq('id', 1)))).toBe(true);
    });

    it('rejects unknown fields, cycles, malformed nodes, empty logic, and undefined policy values', () => {
        expect(() => eq('ownerId', undefined as never)).toThrow(PolicyError);
        expect(() => eq('id', NaN)).toThrow(PolicyError);
        expect(() => eq('__proto__', 'x')).toThrow(PolicyError);
        expect(() => and()).toThrow(PolicyError);
        expect(() => or()).toThrow(PolicyError);
        expect(() => compilePolicyScope(eq('missing', 'x'), Object.keys(ROW))).toThrow(PolicyError);
        expect(() => compilePolicyScope({ kind: 'unknown' } as never, Object.keys(ROW))).toThrow(PolicyError);
        const cycle = { kind: 'not', expression: undefined } as unknown as {
            kind: 'not';
            expression: FilterExpression;
        };
        cycle.expression = cycle;
        expect(() => compilePolicyScope(cycle, Object.keys(ROW))).toThrow(PolicyError);
    });

    it('rejects missing subject attributes and invalid scope returns before query execution', async () => {
        const { query, backend } = fixture();
        await expect(query.authorizedFor({}, 'read').all()).rejects.toMatchObject({ code: 'POLICY_SCOPE_INVALID' });
        const invalid = fixture([{ resource: 'Project', actions: { read: { scope: (() => undefined) as never } } }]);
        await expect(invalid.query.authorizedFor({}, 'read').all()).rejects.toMatchObject({
            code: 'POLICY_SCOPE_INVALID',
        });
        const schemas = { ...SCHEMAS, where: z.strictObject({ ownerId: z.strictObject({ equals: z.string() }) }) };
        const typed = new QuerySet(
            { identity: 'Project', metadata: METADATA, schemas, authorization: fixture().authorization },
            backend,
        );
        await expect(typed.authorizedFor({ id: 123 }, 'read').all()).rejects.toMatchObject({
            code: 'POLICY_SCOPE_INVALID',
            status: 500,
        });
        expect(backend.all).not.toHaveBeenCalled();
        expect(invalid.backend.all).not.toHaveBeenCalled();
    });

    it('does not let composed Where schema transforms strip authorization predicates', async () => {
        const { backend, authorization } = fixture();
        const schemas = { ...SCHEMAS, where: z.record(z.string(), z.unknown()).transform(() => ({})) };
        const query = new QuerySet({ identity: 'Project', metadata: METADATA, schemas, authorization }, backend);
        await query.authorizedFor({ id: 'alice' }, 'read').all();
        expect(backend.all).toHaveBeenCalledWith({ filters: [{ ownerId: { equals: 'alice' } }], orderBy: [] });
    });
});

describe('Policy registration', () => {
    it('validates and freezes definitions and rejects duplicate identities across apps', () => {
        const operations = ['read'] as const;
        const definition = definePolicy({
            resource: 'Project',
            actions: { read: { authorize: () => allow(), operations } },
        });
        expect(Object.isFrozen(definition.actions.read!.operations)).toBe(true);
        const scope = () => eq('id', 1);
        const inheritedAction = Object.create({ scope }) as PolicyDefinition['actions'][string];
        expect(definePolicy({ resource: 'Project', actions: { read: inheritedAction } }).actions.read!.scope).toBe(
            scope,
        );
        expect(() => new AuthorizationEngine([definition, definition])).toThrowError(PolicyError);
        expect(() =>
            definePolicy({ resource: 'Project', actions: { read: { authorize: true as never } } }),
        ).toThrowError(PolicyError);
        expect(() =>
            definePolicy({ resource: 'Project', actions: { read: { operations: ['bad'] as never } } }),
        ).toThrowError(PolicyError);
        expect(() => defineApp({ name: 'projects', policies: {} as never })).toThrowError(PolicyError);
        expect(() =>
            defineApplication({
                apps: [{ name: 'projects', policies: [definition] }],
                policies: [definition],
                database: { kind: 'prisma', provider: 'postgresql', connection: 'unused' },
            }),
        ).toThrowError(PolicyError);
    });

    it('makes app policies available before configure hooks and leaves unregistered resources default-deny', async () => {
        const seen: unknown[] = [];
        const application = defineApplication({
            apps: [
                defineApp({
                    name: 'projects',
                    policies: [{ resource: 'admin', actions: { 'admin.access': { authorize: () => allow() } } }],
                    async configure({ authorization }) {
                        seen.push(
                            await authorization.authorize({
                                identity: 'admin',
                                subject: {},
                                action: 'admin.access',
                                environment: {},
                            }),
                        );
                    },
                }),
            ],
            database: { kind: 'prisma', provider: 'postgresql', connection: 'unused' },
        });
        await application.start();
        expect(seen).toEqual([allow()]);
        expect(
            await application.authorization.authorize({
                identity: 'Project',
                subject: {},
                action: 'read',
                environment: {},
            }),
        ).toEqual(deny('POLICY_MISSING'));
        await application.shutdown();
    });
});
