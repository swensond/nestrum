import type { PrismaProvider, QueryBackend, QuerySpec } from '@nestrum/core';
import { AppError } from '@nestrum/core';
import type { PrismaQueryBackendOptions } from '@nestrum/prisma/querysets';
import { createPrismaQueryBackend } from '@nestrum/prisma/querysets';
import type { CleanedWhere, CustomAdapter, DBAdapterInstance } from 'better-auth/adapters';
import { createAdapterFactory } from 'better-auth/adapters';
import type { AuthModel, AuthStorageModel } from '#auth/contracts/contracts';
import { AUTH_MODELS } from '#auth/contracts/contracts';

export type AuthPrismaBinding = {
    readonly database: string;
    readonly collections: Readonly<Record<AuthStorageModel, Parameters<typeof createPrismaQueryBackend>[0]>>;
    readonly counts?: Readonly<
        Record<AuthStorageModel, Extract<PrismaQueryBackendOptions, { provider: 'mongodb' }>['count']>
    >;
};

export function authQueryBackend(
    binding: AuthPrismaBinding,
    provider: PrismaProvider,
    model: AuthStorageModel,
): QueryBackend {
    const collection = binding.collections[model];
    if (!collection) {
        throw new AppError('AUTH_MODEL_MISSING', `Prisma auth collection ${model} is missing.`);
    }

    return createPrismaQueryBackend(
        collection,
        provider === 'postgresql'
            ? { provider }
            : { provider, count: binding.counts?.[model] as NonNullable<AuthPrismaBinding['counts']>[AuthModel] },
    );
}

const OPERATORS = {
    eq: 'equals',
    ne: 'not',
    lt: 'lt',
    lte: 'lte',
    gt: 'gt',
    gte: 'gte',
    in: 'in',
    not_in: 'notIn',
} as const;

export function authWhere(where: readonly CleanedWhere[] = []): object {
    const groups: { AND: object[]; OR: object[] } = { AND: [], OR: [] };
    for (const condition of where) {
        const operator = OPERATORS[(condition.operator ?? 'eq') as keyof typeof OPERATORS];
        if (
            !operator ||
            condition.mode === 'insensitive' ||
            !/^[A-Za-z][A-Za-z0-9_]*$/.test(condition.field) ||
            ['constructor', 'prototype', '__proto__'].includes(condition.field)
        ) {
            throw new AppError('AUTH_QUERY_UNSUPPORTED', 'Auth adapter does not support this predicate.');
        }
        groups[condition.connector ?? 'AND'].push({ [condition.field]: { [operator]: condition.value } });
    }

    return { ...(groups.AND.length ? { AND: groups.AND } : {}), ...(groups.OR.length ? { OR: groups.OR } : {}) };
}

export function createPrismaAuthAdapter(binding: AuthPrismaBinding, provider: PrismaProvider): DBAdapterInstance {
    const backends: Record<string, QueryBackend> = Object.create(null) as Record<string, QueryBackend>;
    for (const model of AUTH_MODELS) {
        backends[model] = authQueryBackend(binding, provider, model);
    }

    return createAdapterFactory({
        config: {
            adapterId: 'nestrum-prisma8',
            adapterName: 'Nestrum Prisma 8',
            supportsDates: provider === 'mongodb',
            supportsBooleans: true,
            supportsNumericIds: false,
            supportsUUIDs: false,
            supportsJSON: false,
            supportsArrays: false,
            transaction: false,
        },
        adapter: ({ schema, getDefaultModelName, getFieldName }) => {
            const backend = (model: string): QueryBackend => {
                const canonical = model[0]?.toUpperCase() + model.slice(1);
                const resolved = canonical === undefined ? undefined : backends[canonical];
                if (resolved === undefined) {
                    throw new AppError('AUTH_MODEL_PROTECTED', 'Auth adapter can access only its owned models.');
                }

                return resolved;
            };
            const query = (model: string, where: CleanedWhere[] = [], limit?: number): QuerySpec => {
                // biome-ignore lint/style/noNonNullAssertion: better-auth resolves the model before adapting a call
                const modelSchema = schema[getDefaultModelName(model)]!;
                const allowed = [
                    'id',
                    ...Object.keys(modelSchema.fields).map((field) => getFieldName({ model, field })),
                ];
                if (where.some((entry) => !allowed.includes(entry.field))) {
                    throw new AppError('AUTH_QUERY_UNSUPPORTED', 'Unknown auth predicate field.');
                }

                return {
                    filters: where.length ? [authWhere(where)] : [],
                    orderBy: [],
                    ...(limit === undefined ? {} : { limit }),
                };
            };
            const project = (row: Record<string, unknown>, select?: readonly string[]): Record<string, unknown> =>
                select === undefined
                    ? row
                    : Object.fromEntries(
                          select.filter((field) => Object.hasOwn(row, field)).map((field) => [field, row[field]]),
                      );
            const find = async (
                model: string,
                where: CleanedWhere[],
                select?: readonly string[],
            ): Promise<Record<string, unknown> | null> => {
                const row = (await backend(model).all(query(model, where, 1)))[0] as
                    | Record<string, unknown>
                    | undefined;

                return row === undefined ? null : project(row, select);
            };
            const guarded = (where: CleanedWhere[], row: Record<string, unknown>): CleanedWhere[] => [
                ...where,
                { field: 'id', operator: 'eq', value: row.id as string, connector: 'AND', mode: 'sensitive' },
            ];

            return {
                create: async <T extends Record<string, unknown>>({ model, data }: { model: string; data: T }) =>
                    (await backend(model).create(data)) as T,
                findOne: async <T>({
                    model,
                    where,
                    select,
                }: {
                    model: string;
                    where: CleanedWhere[];
                    select?: string[] | undefined;
                    join?: unknown;
                }) => (await find(model, where, select)) as T | null,
                findMany: async <T>({
                    model,
                    where,
                    limit,
                    offset,
                    sortBy,
                    select,
                }: Parameters<CustomAdapter['findMany']>[0]) => {
                    const skip = offset ?? 0;
                    if (
                        !Number.isSafeInteger(skip) ||
                        skip < 0 ||
                        !Number.isSafeInteger(limit) ||
                        limit < 0 ||
                        skip + limit > 10_000
                    ) {
                        throw new AppError('AUTH_QUERY_UNSUPPORTED', 'Invalid auth query window.');
                    }
                    const selection = query(model, where, skip + limit);
                    const rows = await backend(model).all({ ...selection, orderBy: sortBy ? [sortBy] : [] });

                    return rows.slice(skip).map((row) => project(row as Record<string, unknown>, select)) as T[];
                },
                count: async ({ model, where }) => backend(model).count(query(model, where)),
                update: async <T>({ model, where, update }: { model: string; where: CleanedWhere[]; update: T }) => {
                    if (!where.length) {
                        return null;
                    }
                    const row = await find(model, where);
                    if (!row) {
                        return null;
                    }
                    const matched = guarded(where, row);
                    const count = await backend(model).update(query(model, matched), update as object);
                    if (count === 0) {
                        return null;
                    }
                    if (count !== 1) {
                        throw new AppError(
                            'AUTH_MUTATION_INVALID',
                            'Single auth update affected an invalid number of records.',
                        );
                    }

                    return (await find(model, [
                        { field: 'id', value: row.id as string, operator: 'eq', connector: 'AND', mode: 'sensitive' },
                    ])) as T | null;
                },
                updateMany: async ({ model, where, update }) => {
                    if (!where.length) {
                        throw new AppError('AUTH_QUERY_UNSUPPORTED', 'Unscoped auth updates are forbidden.');
                    }

                    return backend(model).update(query(model, where), update);
                },
                delete: async ({ model, where }) => {
                    if (!where.length) {
                        throw new AppError('AUTH_QUERY_UNSUPPORTED', 'Unscoped auth deletion is forbidden.');
                    }
                    const row = await find(model, where);
                    if (row) {
                        await backend(model).delete(query(model, guarded(where, row)));
                    }
                },
                deleteMany: async ({ model, where }) => {
                    if (!where.length) {
                        throw new AppError('AUTH_QUERY_UNSUPPORTED', 'Unscoped auth deletion is forbidden.');
                    }

                    return backend(model).delete(query(model, where));
                },
            } satisfies CustomAdapter;
        },
    });
}
