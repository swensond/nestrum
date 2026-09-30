import type { QueryBackend, QuerySpec } from '@nestrum/core';
import { QuerySetError } from '@nestrum/core';
import { and, not, or } from '@prisma/orm-postgres/orm-client';

type SqlPredicate = Parameters<typeof and>[number];
type CollectionShape = {
    all(): PromiseLike<readonly object[]> | AsyncIterable<object> | readonly object[];
    create(data: never): PromiseLike<object>;
    updateAndCount(data: never): PromiseLike<number>;
    deleteAndCount(): PromiseLike<number>;
};
type ResultRow<Result> = Result extends readonly (infer Row extends object)[]
    ? Row
    : Result extends AsyncIterable<infer Row extends object>
      ? Row
      : never;
type Rows<Raw extends CollectionShape> = ResultRow<Awaited<ReturnType<Raw['all']>>>;
type Create<Raw extends CollectionShape> = Extract<Parameters<Raw['create']>[0], object>;
type Update<Raw extends CollectionShape> = Exclude<
    Extract<Parameters<Raw['updateAndCount']>[0], object>,
    (...args: never[]) => unknown
>;
function invoke(target: unknown, method: string, ...args: unknown[]): unknown {
    if (!target || (typeof target !== 'object' && typeof target !== 'function')) {
        throw new QuerySetError('QUERY_OPERATION_UNSUPPORTED', `Prisma target does not support ${method}.`);
    }
    const callable = (target as Record<string, unknown>)[method];
    if (typeof callable !== 'function') {
        throw new QuerySetError(
            'QUERY_OPERATION_UNSUPPORTED',
            `Installed Prisma collection does not support ${method}.`,
        );
    }

    return Reflect.apply(callable, target, args);
}

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new QuerySetError('QUERY_ARGUMENT_INVALID', 'Expected a filter object.');
    }

    return value as Record<string, unknown>;
}

function isFilter(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

function sqlFilter(where: object, fields: Record<string, unknown>): SqlPredicate {
    const predicates: SqlPredicate[] = [];
    for (const [name, value] of Object.entries(where)) {
        if (value === undefined) {
            continue;
        }
        if (name === 'AND' || name === 'OR' || name === 'NOT') {
            const nested = (Array.isArray(value) ? value : [value]).map((entry) => sqlFilter(record(entry), fields));
            predicates.push(
                name === 'OR'
                    ? or(...nested)
                    : name === 'NOT'
                      ? and(...nested.map((entry) => not(entry)))
                      : and(...nested),
            );
            continue;
        }
        const field = fields[name];
        const operations = isFilter(value) ? value : { equals: value };
        for (const [operator, operand] of Object.entries(operations)) {
            if (operand === undefined) {
                continue;
            }
            if (operator === 'equals' || operator === 'not') {
                const expression = invoke(
                    field,
                    operand === null ? 'isNull' : 'eq',
                    ...(operand === null ? [] : [operand]),
                ) as SqlPredicate;
                predicates.push(operator === 'not' ? not(expression) : expression);
            } else if (operator === 'notIn') {
                predicates.push(not(invoke(field, 'in', operand) as SqlPredicate));
            } else if (['in', 'lt', 'lte', 'gt', 'gte'].includes(operator)) {
                predicates.push(invoke(field, operator, operand) as SqlPredicate);
            } else {
                throw new QuerySetError(
                    'QUERY_OPERATION_UNSUPPORTED',
                    `Prisma 8 QuerySets do not yet compile ${operator} filters; use raw() for provider operations.`,
                );
            }
        }
    }

    return and(...predicates);
}

export function createPrismaQueryBackend<Raw extends CollectionShape>(
    collection: Raw,
): QueryBackend<Rows<Raw>, Create<Raw>, Update<Raw>, Raw> {
    function select(query: QuerySpec, window = true): unknown {
        let selected: unknown = collection;
        for (const filter of query.filters) {
            selected = invoke(selected, 'where', (fields: Record<string, unknown>) => sqlFilter(filter, fields));
        }
        if (window && query.orderBy.length) {
            selected = invoke(
                selected,
                'orderBy',
                query.orderBy.map(
                    (order) => (fields: Record<string, unknown>) => invoke(fields[order.field], order.direction),
                ),
            );
        }
        if (window && query.limit !== undefined) {
            selected = invoke(selected, 'limit', query.limit);
        }

        return selected;
    }

    return Object.freeze({
        raw: collection,
        async all(query: QuerySpec) {
            const result = await invoke(select(query), 'all');
            if (result && typeof result === 'object' && Symbol.asyncIterator in result) {
                const rows: Rows<Raw>[] = [];
                for await (const row of result as AsyncIterable<Rows<Raw>>) {
                    rows.push(row);
                }

                return rows;
            }
            if (!Array.isArray(result)) {
                throw new QuerySetError(
                    'QUERY_OPERATION_UNSUPPORTED',
                    'Prisma all() returned neither an array nor an async iterable.',
                );
            }

            return result as readonly Rows<Raw>[];
        },
        async count(query: QuerySpec) {
            const result = (await invoke(select(query, false), 'aggregate', (aggregate: { count(): unknown }) => ({
                total: aggregate.count(),
            }))) as { total: number };

            return result.total;
        },
        async create(data: Create<Raw>) {
            return (await invoke(collection, 'create', data)) as Rows<Raw>;
        },
        async update(query: QuerySpec, data: Update<Raw>) {
            return (await invoke(
                query.filters.length ? select(query, false) : invoke(collection, 'where', {}),
                'updateAndCount',
                data,
            )) as number;
        },
        async delete(query: QuerySpec) {
            return (await invoke(
                query.filters.length ? select(query, false) : invoke(collection, 'where', {}),
                'deleteAndCount',
            )) as number;
        },
    });
}
