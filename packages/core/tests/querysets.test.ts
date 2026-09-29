import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { allow, AuthorizationEngine, bindResourceQuerySets, defineApplication, defineResource, QuerySet, QuerySetError } from '../src/index.js';
import type { ModelMetadata, QueryBackend, QuerySpec, QueryWhere, ResourceModel } from '../src/index.js';

type Project = { id: number; name: string; status: string; createdAt: Date };
type Create = Omit<Project, 'id'>;
type Update = Partial<Omit<Project, 'id'>>;
const READ = z.strictObject({ id: z.number().int(), name: z.string(), status: z.string(), createdAt: z.date() });
const WHERE = z.strictObject({ id: z.number().optional(), name: z.string().optional(), status: z.string().optional(), createdAt: z.date().optional() });
const POLICY = { resource: 'default.Project', actions: { test: { authorize: () => allow(), operations: ['read', 'count', 'create', 'update', 'delete'] as const } } };
const CONTEXT = {
    authorization: new AuthorizationEngine([POLICY]),
    identity: 'default.Project' as const,
    metadata: { database: 'default', name: 'Project', identity: 'default.Project', provider: 'postgresql', namespace: 'public', relations: [],
        fields: ['id', 'name', 'status', 'createdAt'].map((name) => ({ name, codec: 'pg/text@1', kind: 'string', array: false, nullable: false, optional: false, primaryKey: name === 'id', hasCreateDefault: name === 'id', hasUpdateDefault: false })) } as ModelMetadata,
    schemas: { model: READ, read: READ, create: READ.omit({ id: true }), update: READ.omit({ id: true }).partial(), where: WHERE,
        orderBy: z.strictObject({ id: z.enum(['asc', 'desc']).optional(), name: z.enum(['asc', 'desc']).optional(), status: z.enum(['asc', 'desc']).optional(), createdAt: z.enum(['asc', 'desc']).optional() }) }
};
const ROW: Project = { id: 1, name: 'Example', status: 'active', createdAt: new Date('2026-01-01') };
function fixture() {
    const backend = {
        raw: { native: true } as { native: boolean }, all: vi.fn(async (_query: QuerySpec): Promise<Project[]> => [ROW]),
        count: vi.fn(async (_query: QuerySpec) => 3), create: vi.fn(async (_data: Create) => ROW),
        update: vi.fn(async (_query: QuerySpec, _data: Update) => 2), delete: vi.fn(async (_query: QuerySpec) => 2)
    } satisfies QueryBackend<Project, Create, Update, { native: boolean }>;

    return { backend, query: new QuerySet(CONTEXT, backend).authorizedFor({}, 'test') };
}

describe('Immutable typed QuerySets', () => {
    it('branches lazily without changing its parent and replaces ordering/limits', async () => {
        const { backend, query } = fixture();
        const active = query.filter({ status: 'active' });
        const recent = active.filter({ name: 'Example' }).orderBy('-createdAt').limit(20);
        const archived = query.filter({ status: 'archived' });
        expect(backend.all).not.toHaveBeenCalled();
        expect(Object.isFrozen(query)).toBe(true);
        await recent.all();
        expect(backend.all).toHaveBeenLastCalledWith({ filters: [{ status: 'active' }, { name: 'Example' }], orderBy: [{ field: 'createdAt', direction: 'desc' }], limit: 20 });
        await archived.all();
        expect(backend.all).toHaveBeenLastCalledWith({ filters: [{ status: 'archived' }], orderBy: [] });
        await query.all();
        expect(backend.all).toHaveBeenLastCalledWith({ filters: [], orderBy: [] });
        await recent.orderBy('name').limit(2).all();
        expect(backend.all.mock.lastCall?.[0].orderBy).toEqual([{ field: 'name', direction: 'asc' }]);
    });

    it('snapshots caller objects/dates and protects later evaluations from backend mutation', async () => {
        const { query, backend } = fixture();
        const when = new Date('2026-01-01');
        const input = { createdAt: when };
        const branch = query.filter(input);
        when.setUTCFullYear(2030);
        await branch.all();
        const spec = backend.all.mock.lastCall![0];
        const date = (spec.filters[0] as { createdAt: Date }).createdAt;
        expect(date.getUTCFullYear()).toBe(2026);
        date.setUTCFullYear(2040);
        await branch.all();
        expect((backend.all.mock.lastCall![0].filters[0] as { createdAt: Date }).createdAt.getUTCFullYear()).toBe(2026);
    });

    it('supports first/exists and zero limits without fetching rows', async () => {
        const { query, backend } = fixture();
        expect(await query.first()).toEqual(ROW);
        expect(backend.all.mock.lastCall![0].limit).toBe(1);
        expect(await query.exists()).toBe(true);
        backend.all.mockClear();
        expect(await query.limit(0).all()).toEqual([]);
        expect(await query.limit(0).first()).toBeNull();
        expect(await query.limit(0).exists()).toBe(false);
        expect(backend.all).not.toHaveBeenCalled();
    });

    it('get checks at most two rows and reports missing/multiple matches', async () => {
        const { query, backend } = fixture();
        expect(await query.get({ id: 1 })).toEqual(ROW);
        expect(backend.all.mock.lastCall![0]).toEqual({ filters: [{ id: 1 }], orderBy: [], limit: 2 });
        backend.all.mockResolvedValueOnce([]);
        await expect(query.get()).rejects.toMatchObject({ code: 'QUERY_NOT_FOUND', status: 404 });
        backend.all.mockResolvedValueOnce([ROW, { ...ROW, id: 2 }]);
        await expect(query.get()).rejects.toMatchObject({ code: 'QUERY_MULTIPLE_RESULTS' });
    });

    it('count ignores ordering/limit, create validates data, and mutations retain filters', async () => {
        const { query, backend } = fixture();
        expect(await query.filter({ status: 'active' }).orderBy('-id').limit(1).count()).toBe(3);
        expect(backend.count).toHaveBeenCalledWith({ filters: [{ status: 'active' }], orderBy: [] });
        const { id, ...create } = ROW;
        expect(await query.filter({ status: 'archived' }).create(create)).toEqual(ROW);
        expect(backend.create).toHaveBeenCalledWith(create);
        expect(await query.filter({ status: 'active' }).update({ name: 'Changed' })).toBe(2);
        expect(backend.update).toHaveBeenCalledWith({ filters: [{ status: 'active' }], orderBy: [] }, { name: 'Changed' });
        expect(await query.filter({ id: 1 }).delete()).toBe(2);
        expect(backend.delete).toHaveBeenCalledWith({ filters: [{ id: 1 }], orderBy: [] });
        await expect(query.update({ id: 2 } as Update)).rejects.toThrow();
        await expect(query.create({ name: 'Only name' } as Create)).rejects.toThrow();
    });

    it.each([-1, 1.5, Infinity, NaN])('rejects invalid limit %s', (limit) => {
        expect(() => fixture().query.limit(limit)).toThrow(QuerySetError);
    });

    it('rejects unknown ordering/filter fields and windowed get/writes before evaluation', async () => {
        const { query, backend } = fixture();
        expect(() => query.orderBy('missing' as 'id')).toThrow(QuerySetError);
        expect(() => query.filter({ unknown: 1 } as QueryWhere<Project>)).toThrow();
        for (const operation of [query.limit(1).get(), query.limit(1).update({ name: 'x' }), query.limit(1).delete()]) {
            await expect(operation).rejects.toMatchObject({ code: 'QUERY_ARGUMENT_INVALID' });
        }
        expect(backend.all).not.toHaveBeenCalled();
    });

    it('validates returned records and preserves backend errors', async () => {
        const { query, backend } = fixture();
        backend.all.mockResolvedValueOnce([{ id: 'bad' } as unknown as Project]);
        await expect(query.all()).rejects.toMatchObject({ code: 'QUERY_RESULT_INVALID', status: 500, cause: expect.any(z.ZodError) });
        const cause = new Error('Database failure');
        backend.all.mockRejectedValueOnce(cause);
        await expect(query.all()).rejects.toBe(cause);
    });

    it('keeps primary key predicates intact through composed Where transforms and immutable branches', async () => {
        const { backend } = fixture();
        const query = new QuerySet({ ...CONTEXT, schemas: { ...CONTEXT.schemas, where: z.record(z.string(), z.unknown()).transform(() => ({})) } }, backend).authorizedFor({}, 'test');
        await query.filterPrimaryKey(1).update({ name: 'Changed' });
        expect(backend.update.mock.lastCall?.[0].filters).toEqual([{ id: 1 }]);
        await query.all();
        expect(backend.all.mock.lastCall?.[0].filters).toEqual([]);
        expect(() => query.filterPrimaryKey(null)).toThrow(QuerySetError);
        expect(() => query.filterPrimaryKey('bad')).toThrow(z.ZodError);
    });

    it('raw returns the exact original delegate regardless of filters or ordering', () => {
        const { query, backend } = fixture();
        expect(query.filter({ status: 'active' }).orderBy('name').limit(1).raw()).toBe(backend.raw);
    });

    it('extends QuerySets while preserving subclass methods through chaining', async () => {
        class ProjectQueries extends QuerySet<Project, Create, Update, { native: boolean }> {
            active() { return this.filter({ status: 'active' }); }
        }
        const { query, backend } = fixture();
        const custom = query.extend(ProjectQueries).active().orderBy('-createdAt').limit(2);
        expect(custom).toBeInstanceOf(ProjectQueries);
        await custom.all();
        expect(backend.all.mock.lastCall![0].filters).toEqual([{ status: 'active' }]);
    });

    it('exposes irreplaceable, typed, chainable named managers and rejects cross-resource factories', async () => {
        const { backend } = fixture();
        const access = bindResourceQuerySets(CONTEXT, backend, { active: (query) => query.filter({ status: 'active' }), archived: (query) => query.filter({ status: 'archived' }) });
        expect(Object.isFrozen(access)).toBe(true);
        expect(Reflect.set(access, 'objects', access.active)).toBe(false);
        await access.active.authorizedFor({}, 'test').filter({ name: 'Example' }).all();
        expect(backend.all.mock.lastCall![0].filters).toEqual([{ status: 'active' }, { name: 'Example' }]);
        expect(() => bindResourceQuerySets(CONTEXT, backend, { objects: (query) => query })).toThrow(QuerySetError);
        expect(() => bindResourceQuerySets(CONTEXT, backend, { other: () => fixture().query })).toThrow(QuerySetError);
        if (false) {
            // @ts-expect-error Invalid row field is rejected by typed QuerySets.
            access.objects.filter({ missing: 1 });
            // @ts-expect-error Create requires the declared input fields.
            access.objects.create({ name: 'incomplete' });
            // @ts-expect-error Unknown order key is rejected.
            access.active.orderBy('-missing');
        }
    });

    it('binds a supplied backend and evaluates a named manager from a configure hook', async () => {
        const { backend } = fixture();
        const application = defineApplication({ policies: [POLICY], databases: { default: { kind: 'prisma', provider: 'postgresql', connection: 'unused' } },
            resourceModels: [{ ...CONTEXT.schemas, metadata: CONTEXT.metadata, queryBackend: backend }],
            apps: [{ name: 'projects', resources: [defineResource({ model: 'Project', managers: { active: (query) => query.filter({ status: 'active' }) } })],
                async configure({ resources }) { await resources.get('default.Project').managers.active!.authorizedFor({}, 'test').all(); } }] });
        await application.start();
        expect(backend.all).toHaveBeenCalledWith({ filters: [{ status: 'active' }], orderBy: [] });
        expect(application.resources.get('default.Project').objects.raw()).toBe(backend.raw);
        await application.shutdown();
    });

    it('registers objects and named managers before hooks, even without a live backend', async () => {
        const family: ResourceModel = { ...CONTEXT.schemas, metadata: CONTEXT.metadata };
        const application = defineApplication({ policies: [POLICY], databases: { default: { kind: 'prisma', provider: 'postgresql', connection: 'unused' } },
            apps: [], resourceModels: [family], resources: [defineResource({ model: 'Project', managers: { active: (query) => query.filter({ status: 'active' }) } })] });
        await application.start();
        const resource = application.resources.get('default.Project');
        expect(resource.objects).toBeInstanceOf(QuerySet);
        expect(resource.managers.active).toBeInstanceOf(QuerySet);
        expect(Reflect.set(resource, 'objects', resource.managers.active)).toBe(false);
        await expect(resource.objects.authorizedFor({}, 'test').all()).rejects.toMatchObject({ code: 'QUERY_BACKEND_MISSING' });
        await application.shutdown();
    });
});
