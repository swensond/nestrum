import type { ModelMetadata, QuerySpec } from '@nestrum/core';
import {
    AuthorizationEngine,
    and,
    compilePolicyScope,
    eq,
    inFilter,
    isNull,
    neq,
    not,
    notIn,
    or,
    QuerySet,
    QuerySetError,
} from '@nestrum/core';
import { describe, expect, it } from 'vitest';
import { generateModelSchemas } from '../../zod/src/index.js';
import { createPrismaQueryBackend } from '../src/querysets.js';

const SPEC: QuerySpec = {
    filters: [{ name: 'Hello' }, { id: { gte: 1, notIn: [5] } }],
    orderBy: [
        { field: 'id', direction: 'desc' },
        { field: 'name', direction: 'asc' },
    ],
    limit: 3,
};
function queryMetadata(identity: ModelMetadata['identity'], names: string[]): ModelMetadata {
    return {
        identity,
        name: identity,
        provider: 'postgresql',
        namespace: 'public',
        relations: [],
        fields: names.map((field) => ({
            name: field,
            codec: field === 'id' ? 'pg/int4@1' : 'pg/text@1',
            kind: field === 'id' ? 'number' : 'string',
            array: false,
            nullable: true,
            optional: false,
            primaryKey: field === 'id',
            hasCreateDefault: false,
            hasUpdateDefault: false,
        })),
    };
}

function sqlCollection() {
    const calls: { method: string; value?: unknown }[] = [];
    const field = (name: string) =>
        Object.fromEntries(
            ['eq', 'isNull', 'in', 'lt', 'lte', 'gt', 'gte', 'asc', 'desc'].map((operator) => [
                operator,
                (value?: unknown) => ({
                    kind: operator,
                    field: name,
                    value,
                    not() {
                        return { kind: 'not', expr: { kind: operator, field: name, value } };
                    },
                }),
            ]),
        );
    const fields = { id: field('id'), name: field('name') };
    const collection = {
        where(value: object | ((accessors: typeof fields) => unknown)) {
            calls.push({ method: 'where', value: typeof value === 'function' ? value(fields) : value });
            return collection;
        },
        orderBy(value: ((accessors: typeof fields) => unknown)[]) {
            calls.push({ method: 'orderBy', value: value.map((entry) => entry(fields)) });
            return collection;
        },
        limit(value: number) {
            calls.push({ method: 'limit', value });
            return collection;
        },
        async all() {
            calls.push({ method: 'all' });
            return [{ id: 1, name: 'Hello' }];
        },
        async create(value: { name: string }) {
            calls.push({ method: 'create', value });
            return { id: 1, name: value.name };
        },
        async updateAndCount(value: { name?: string }) {
            calls.push({ method: 'updateAndCount', value });
            return 2;
        },
        async deleteAndCount() {
            calls.push({ method: 'deleteAndCount' });
            return 3;
        },
        async aggregate(selector: (aggregate: { count(): object }) => object) {
            calls.push({ method: 'aggregate', value: selector({ count: () => ({ count: '*' }) }) });
            return { total: 7 };
        },
    };

    return { collection, calls };
}

describe('Installed Prisma 8 query adapters', () => {
    it('applies an authorized QuerySet scope alongside caller filters in native SQL predicates', async () => {
        const { collection, calls } = sqlCollection();
        const metadata = queryMetadata('Project', ['id', 'name']);
        const schemas = generateModelSchemas(metadata);
        const authorization = new AuthorizationEngine([
            {
                resource: 'Project',
                actions: { read: { scope: ({ subject }) => eq('id', subject.id as number) } },
            },
        ]);
        const query = new QuerySet(
            { identity: 'Project', metadata, schemas, authorization },
            createPrismaQueryBackend(collection),
        );
        await query.authorizedFor({ id: 1 }, 'read').filter({ name: 'Hello' }).all();
        expect(calls.map((call) => call.method)).toEqual(['where', 'where', 'all']);
        expect(calls[0]?.value).toMatchObject({ exprs: [{ kind: 'eq', field: 'name', value: 'Hello' }] });
        expect(calls[1]?.value).toMatchObject({ exprs: [{ kind: 'eq', field: 'id', value: 1 }] });
    });

    it('compiles every authorization AST helper into native SQL predicate nodes', async () => {
        const { collection, calls } = sqlCollection();
        const scope = and(
            eq('id', 1),
            neq('name', 'Blocked'),
            inFilter('id', [1, 2]),
            notIn('id', [3]),
            isNull('name'),
            or(eq('id', 4), not(eq('id', 5))),
        );
        await createPrismaQueryBackend(collection).all({
            filters: [compilePolicyScope(scope, ['id', 'name'])],
            orderBy: [],
        });
        expect(calls.map((call) => call.method)).toEqual(['where', 'all']);
        expect(calls[0]?.value).toMatchObject({
            kind: 'and',
            exprs: [
                {
                    kind: 'and',
                    exprs: [
                        { kind: 'and', exprs: [{ kind: 'eq' }] },
                        { kind: 'and', exprs: [{ kind: 'not' }] },
                        { kind: 'and', exprs: [{ kind: 'in' }] },
                        { kind: 'and', exprs: [{ kind: 'not' }] },
                        { kind: 'and', exprs: [{ kind: 'isNull' }] },
                        { kind: 'and', exprs: [{ kind: 'or' }] },
                    ],
                },
            ],
        });
    });

    it('compiles SQL equality/ranges/logical operators and ordered selector arrays using public Prisma AST', async () => {
        const { collection, calls } = sqlCollection();
        const backend = createPrismaQueryBackend(collection);
        expect(await backend.all(SPEC)).toEqual([{ id: 1, name: 'Hello' }]);
        expect(calls.map((call) => call.method)).toEqual(['where', 'where', 'orderBy', 'limit', 'all']);
        expect(calls[0]?.value).toMatchObject({ kind: 'and', exprs: [{ kind: 'eq', field: 'name', value: 'Hello' }] });
        expect(calls[1]?.value).toMatchObject({ kind: 'and', exprs: [{ kind: 'gte' }, { kind: 'not' }] });
        expect(calls[2]?.value).toMatchObject([
            { kind: 'desc', field: 'id' },
            { kind: 'asc', field: 'name' },
        ]);
        expect(backend.raw).toBe(collection);
        await backend.all({
            filters: [{ OR: [{ id: 1 }, { name: { not: null } }], NOT: { id: { in: [3] } } }],
            orderBy: [],
        });
        expect(calls.at(-2)?.value).toMatchObject({ kind: 'and' });
    });

    it('uses SQL aggregate count and native bulk count terminals without fetching mutation records', async () => {
        const { collection, calls } = sqlCollection();
        const backend = createPrismaQueryBackend(collection);
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
        const backend = createPrismaQueryBackend(collection);
        await backend.update({ filters: [], orderBy: [] }, { name: 'Updated' });
        expect(calls).toEqual([
            { method: 'where', value: {} },
            { method: 'updateAndCount', value: { name: 'Updated' } },
        ]);
    });

    it('rejects unimplemented provider operators rather than broadening filters', async () => {
        const { collection } = sqlCollection();
        await expect(
            createPrismaQueryBackend(collection).all({
                filters: [{ name: { contains: 'text' } }],
                orderBy: [],
            }),
        ).rejects.toThrow(QuerySetError);
    });
});
