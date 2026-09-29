import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AsyncIterableResult } from '@prisma/orm-mongo/components/runtime';
import { createMongoCollection } from '@prisma/orm-mongo/orm';
import { defineApplication, QuerySetError } from '@nestrum/core';
import { prismaDatabase } from '../src/index.js';
import { generatePrismaContracts } from '../src/node.js';
import { createPrismaQueryBackend } from '../src/querysets.js';
import type { QuerySpec } from '@nestrum/core';

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

    it('rejects unimplemented provider operators rather than broadening filters', async () => {
        const { collection } = sqlCollection();
        await expect(createPrismaQueryBackend(collection, { provider: 'postgresql' }).all({ filters: [{ name: { contains: 'text' } }], orderBy: [] })).rejects.toThrow(QuerySetError);
    });
});
