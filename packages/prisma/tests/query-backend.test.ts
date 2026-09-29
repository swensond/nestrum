import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AsyncIterableResult } from '@prisma/orm-mongo/components/runtime';
import { createMongoCollection } from '@prisma/orm-mongo/orm';
import { and, AuthorizationEngine, compilePolicyScope, defineApplication, eq, inFilter, isNull, neq, not, notIn, or, QuerySet, QuerySetError } from '@nestrum/core';
import { generateModelSchemas } from '../../zod/src/index.js';
import { prismaDatabase } from '../src/index.js';
import { generatePrismaContracts } from '../src/node.js';
import { createPrismaQueryBackend } from '../src/querysets.js';
import type { ModelMetadata, QuerySpec } from '@nestrum/core';

const SPEC: QuerySpec = { filters: [{ name: 'Hello' }, { id: { gte: 1, notIn: [5] } }], orderBy: [{ field: 'id', direction: 'desc' }, { field: 'name', direction: 'asc' }], limit: 3 };
let directory: string;
let mongoContract: Parameters<typeof createMongoCollection>[0];
beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'nestrum-query-adapter-'));
    await writeFile(join(directory, 'article.prisma'), 'model Article {\n id ObjectId @id @map("_id")\n name String\n}\n');
    const app = defineApplication({ apps: [{ name: 'articles', prisma: { default: ['article.prisma'] } }],
        databases: { default: prismaDatabase({ provider: 'mongodb', connection: 'unused' }) } });
    const result = await generatePrismaContracts(app, { rootDir: directory, outputDir: 'generated' });
    mongoContract = JSON.parse(await readFile(result.contracts[0]!.contractPath, 'utf8')) as typeof mongoContract;
}, 30_000);
afterAll(async () => {
    if (directory) {
        await rm(directory, { recursive: true, force: true });
    }
});

function queryMetadata(identity: ModelMetadata['identity'], provider: ModelMetadata['provider'], names: string[]): ModelMetadata {
    const [database, name] = identity.split('.');

    return { identity, database: database!, name: name!, provider, namespace: provider === 'postgresql' ? 'public' : '', relations: [],
        fields: names.map((field) => ({ name: field, codec: field === 'id' ? 'pg/int4@1' : 'pg/text@1', kind: field === 'id' ? 'number' : 'string', array: false, nullable: true, optional: false,
            primaryKey: field === 'id' || field === '_id', hasCreateDefault: false, hasUpdateDefault: false })) };
}

function sqlCollection() {
    const calls: { method: string; value?: unknown }[] = [];
    const field = (name: string) => Object.fromEntries(['eq', 'isNull', 'in', 'lt', 'lte', 'gt', 'gte', 'asc', 'desc'].map((operator) =>
        [operator, (value?: unknown) => ({ kind: operator, field: name, value, not() { return { kind: 'not', expr: { kind: operator, field: name, value } }; } })]));
    const fields = { id: field('id'), name: field('name') };
    const collection = {
        where(value: object | ((accessors: typeof fields) => unknown)) { calls.push({ method: 'where', value: typeof value === 'function' ? value(fields) : value }); return collection; },
        orderBy(value: ((accessors: typeof fields) => unknown)[]) { calls.push({ method: 'orderBy', value: value.map((entry) => entry(fields)) }); return collection; },
        limit(value: number) { calls.push({ method: 'limit', value }); return collection; },
        async all() { calls.push({ method: 'all' }); return [{ id: 1, name: 'Hello' }]; },
        async create(value: { name: string }) { calls.push({ method: 'create', value }); return { id: 1, name: value.name }; },
        async updateAndCount(value: { name?: string }) { calls.push({ method: 'updateAndCount', value }); return 2; },
        async deleteAndCount() { calls.push({ method: 'deleteAndCount' }); return 3; },
        async aggregate(selector: (aggregate: { count(): object }) => object) { calls.push({ method: 'aggregate', value: selector({ count: () => ({ count: '*' }) }) }); return { total: 7 }; }
    };

    return { collection, calls };
}

describe('Installed Prisma 8 query adapters', () => {
    it('applies an authorized QuerySet scope alongside caller filters in native SQL predicates', async () => {
        const { collection, calls } = sqlCollection();
        const metadata = queryMetadata('default.Project', 'postgresql', ['id', 'name']);
        const schemas = generateModelSchemas(metadata);
        const authorization = new AuthorizationEngine([{ resource: 'default.Project', actions: { read: { scope: ({ subject }) => eq('id', subject.id as number) } } }]);
        const query = new QuerySet({ identity: 'default.Project', metadata, schemas, authorization }, createPrismaQueryBackend(collection, { provider: 'postgresql' }));
        await query.authorizedFor({ id: 1 }, 'read').filter({ name: 'Hello' }).all();
        expect(calls.map((call) => call.method)).toEqual(['where', 'where', 'all']);
        expect(calls[0]?.value).toMatchObject({ exprs: [{ kind: 'eq', field: 'name', value: 'Hello' }] });
        expect(calls[1]?.value).toMatchObject({ exprs: [{ kind: 'eq', field: 'id', value: 1 }] });
    });

    it('compiles every authorization AST helper into native SQL predicate nodes', async () => {
        const { collection, calls } = sqlCollection();
        const scope = and(eq('id', 1), neq('name', 'Blocked'), inFilter('id', [1, 2]), notIn('id', [3]), isNull('name'), or(eq('id', 4), not(eq('id', 5))));
        await createPrismaQueryBackend(collection, { provider: 'postgresql' }).all({ filters: [compilePolicyScope(scope, ['id', 'name'])], orderBy: [] });
        expect(calls.map((call) => call.method)).toEqual(['where', 'all']);
        expect(calls[0]?.value).toMatchObject({ kind: 'and', exprs: [{ kind: 'and', exprs: [
            { kind: 'and', exprs: [{ kind: 'eq' }] }, { kind: 'and', exprs: [{ kind: 'not' }] }, { kind: 'and', exprs: [{ kind: 'in' }] },
            { kind: 'and', exprs: [{ kind: 'not' }] }, { kind: 'and', exprs: [{ kind: 'isNull' }] }, { kind: 'and', exprs: [{ kind: 'or' }] }
        ] }] });
    });

    it('compiles SQL equality/ranges/logical operators and ordered selector arrays using public Prisma AST', async () => {
        const { collection, calls } = sqlCollection();
        const backend = createPrismaQueryBackend(collection, { provider: 'postgresql' });
        expect(await backend.all(SPEC)).toEqual([{ id: 1, name: 'Hello' }]);
        expect(calls.map((call) => call.method)).toEqual(['where', 'where', 'orderBy', 'limit', 'all']);
        expect(calls[0]?.value).toMatchObject({ kind: 'and', exprs: [{ kind: 'eq', field: 'name', value: 'Hello' }] });
        expect(calls[1]?.value).toMatchObject({ kind: 'and', exprs: [{ kind: 'gte' }, { kind: 'not' }] });
        expect(calls[2]?.value).toMatchObject([{ kind: 'desc', field: 'id' }, { kind: 'asc', field: 'name' }]);
        expect(backend.raw).toBe(collection);
        await backend.all({ filters: [{ OR: [{ id: 1 }, { name: { not: null } }], NOT: { id: { in: [3] } } }], orderBy: [] });
        expect(calls.at(-2)?.value).toMatchObject({ kind: 'and' });
    });

    it('uses SQL aggregate count and native bulk count terminals without fetching mutation records', async () => {
        const { collection, calls } = sqlCollection();
        const backend = createPrismaQueryBackend(collection, { provider: 'postgresql' });
        expect(await backend.count(SPEC)).toBe(7);
        expect(calls.map((call) => call.method)).toEqual(['where', 'where', 'aggregate']);
        expect(await backend.create({ name: 'New' })).toEqual({ id: 1, name: 'New' });
        expect(await backend.update(SPEC, { name: 'Updated' })).toBe(2);
        expect(await backend.delete(SPEC)).toBe(3);
        expect(calls.some((call) => call.method === 'all')).toBe(false);
        if (false) {
            // @ts-expect-error Inferred create input requires name.
            backend.create({});
            // @ts-expect-error Prisma collection return type is inferred.
            const wrong: string = (await backend.all(SPEC))[0]!.id;
            void wrong;
        }
    });

    it('preserves explicit full-model bulk writes by applying an empty native filter', async () => {
        const { collection, calls } = sqlCollection();
        const backend = createPrismaQueryBackend(collection, { provider: 'postgresql' });
        await backend.update({ filters: [], orderBy: [] }, { name: 'Updated' });
        expect(calls).toEqual([{ method: 'where', value: {} }, { method: 'updateAndCount', value: { name: 'Updated' } }]);
    });

    it('executes a real Mongo ORM collection against a recording Prisma executor', async () => {
        const plans: unknown[] = [];
        const executor = {
            query<Row>(plan: unknown) {
                plans.push(plan);
                return new AsyncIterableResult((async function* () { yield { _id: '507f1f77bcf86cd799439011', name: 'Hello' } as unknown as Row; })());
            },
            async execute(plan: unknown) { plans.push(plan); return { affectedRows: 2 }; }
        };
        const collection = createMongoCollection(mongoContract, 'Article', executor);
        const count = vi.fn(async (_filter: unknown) => 4);
        const backend = createPrismaQueryBackend(collection, { provider: 'mongodb', count });
        const spec: QuerySpec = { filters: [{ OR: [{ name: 'Hello' }, { _id: { in: ['507f1f77bcf86cd799439011'] } }] }], orderBy: [{ field: 'name', direction: 'desc' }], limit: 5 };
        expect(await backend.all(spec)).toEqual([{ _id: '507f1f77bcf86cd799439011', name: 'Hello' }]);
        expect(plans[0]).toMatchObject({ collection: 'Article', command: { collection: 'Article', pipeline: [
            { kind: 'match' }, { kind: 'sort', sort: { name: -1 } }, { kind: 'limit' }
        ] } });
        expect(await backend.update(spec, { name: 'Updated' } as never)).toBe(2);
        expect(await backend.delete(spec)).toBe(2);
        expect(await backend.count(spec)).toBe(4);
        expect(count).toHaveBeenCalledWith(expect.objectContaining({ kind: 'and' }));
        expect(backend.raw).toBe(collection);
    });

    it('places ABAC scope predicates in a real Mongo pipeline and passes the same scope to database counts', async () => {
        const plans: unknown[] = [];
        const executor = {
            query<Row>(plan: unknown) { plans.push(plan); return new AsyncIterableResult((async function* () { yield { _id: '507f1f77bcf86cd799439011', name: 'Hello' } as unknown as Row; })()); },
            async execute(plan: unknown) { plans.push(plan); return { affectedRows: 1 }; }
        };
        const count = vi.fn(async (_filter: unknown) => 1);
        const backend = createPrismaQueryBackend(createMongoCollection(mongoContract, 'Article', executor), { provider: 'mongodb', count });
        const metadata = queryMetadata('documents.Article', 'mongodb', ['_id', 'name']);
        const schemas = generateModelSchemas(metadata);
        const authorization = new AuthorizationEngine([{ resource: 'documents.Article', actions: { read: { scope: ({ subject }) => and(eq('_id', subject.id as string), not(neq('name', 'Hello'))) } } }]);
        const query = new QuerySet({ identity: 'documents.Article', metadata, schemas, authorization }, backend).authorizedFor({ id: '507f1f77bcf86cd799439011' }, 'read');
        await query.filter({ name: 'Hello' }).all();
        expect(plans[0]).toMatchObject({ collection: 'Article', command: { pipeline: [
            { kind: 'match', filter: { kind: 'and' } }
        ] } });
        expect(JSON.stringify(plans[0])).toContain('507f1f77bcf86cd799439011');
        expect(await query.count()).toBe(1);
        expect(count).toHaveBeenCalledWith(expect.objectContaining({ kind: 'and' }));
    });

    it('rejects unimplemented provider operators rather than broadening filters', async () => {
        const { collection } = sqlCollection();
        await expect(createPrismaQueryBackend(collection, { provider: 'postgresql' }).all({ filters: [{ name: { contains: 'text' } }], orderBy: [] })).rejects.toThrow(QuerySetError);
    });
});
