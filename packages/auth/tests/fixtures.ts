import type { AuthModel } from '../src/contracts/contracts.js';
import { AUTH_MODELS } from '../src/contracts/contracts.js';

type Row = Record<string, unknown>;
type Predicate = {
    kind: string;
    field?: string;
    value?: unknown;
    expr?: Predicate;
    exprs?: Predicate[];
    not(): Predicate;
};

function matches(row: Row, node: Predicate): boolean {
    switch (node.kind) {
        case 'and':
            return node.exprs!.every((child) => matches(row, child));
        case 'or':
            return node.exprs!.some((child) => matches(row, child));
        case 'not':
            return !matches(row, node.expr!);
        case 'eq':
            return row[node.field!] === node.value;
        case 'isNull':
            return row[node.field!] === null || row[node.field!] === undefined;
        case 'in':
            return (node.value as unknown[]).includes(row[node.field!]);
        case 'lt':
            return (row[node.field!] as string) < (node.value as string);
        case 'lte':
            return (row[node.field!] as string) <= (node.value as string);
        case 'gt':
            return (row[node.field!] as string) > (node.value as string);
        case 'gte':
            return (row[node.field!] as string) >= (node.value as string);
        default:
            throw new Error(`Unsupported fixture predicate ${node.kind}`);
    }
}

function expression(kind: string, field?: string, value?: unknown): Predicate {
    return {
        kind,
        ...(field === undefined ? {} : { field }),
        ...(value === undefined ? {} : { value }),
        not() {
            return { kind: 'not', expr: this, not: () => this };
        },
    };
}

export function storage(database = 'identity', options: { transactions?: boolean } = {}) {
    const records: Record<AuthModel, Row[]> = {
        User: [],
        Account: [],
        Session: [],
        Verification: [],
        TwoFactor: [],
        ApiKey: [],
        SsoProvider: [],
    };
    const operations: { model: AuthModel; operation: string }[] = [];
    const collection = (model: AuthModel, filters: Predicate[] = [], limit?: number, orders: Predicate[] = []) => {
        const fields = new Proxy(
            {},
            {
                get: (_target, name) =>
                    Object.fromEntries(
                        ['eq', 'isNull', 'in', 'lt', 'lte', 'gt', 'gte', 'asc', 'desc'].map((operator) => [
                            operator,
                            (value?: unknown) => expression(operator, name as string, value),
                        ]),
                    ),
            },
        );
        const selected = () => {
            let rows = records[model].filter((row) => filters.every((filter) => matches(row, filter)));
            for (const order of [...orders].reverse()) {
                rows = [...rows].sort(
                    (left, right) =>
                        String(left[order.field!]).localeCompare(String(right[order.field!])) *
                        (order.kind === 'desc' ? -1 : 1),
                );
            }

            return rows;
        };
        return {
            where: (input: object | ((fields: object) => Predicate)) =>
                collection(
                    model,
                    [...filters, typeof input === 'function' ? input(fields) : expression('and')],
                    limit,
                    orders,
                ),
            limit: (input: number) => collection(model, filters, input, orders),
            orderBy: (input: ((fields: object) => Predicate)[]) =>
                collection(
                    model,
                    filters,
                    limit,
                    input.map((order) => order(fields)),
                ),
            async all() {
                operations.push({ model, operation: 'all' });
                return selected()
                    .slice(0, limit)
                    .map((row) => ({ ...row }));
            },
            async create(data: object) {
                operations.push({ model, operation: 'create' });
                const row = data as Row;
                if (
                    records[model].some(
                        (existing) =>
                            existing.id === row.id ||
                            (model === 'User' && existing.email === row.email) ||
                            (model === 'SsoProvider' && existing.providerId === row.providerId) ||
                            (model === 'Session' && existing.token === row.token) ||
                            (model === 'Account' &&
                                existing.providerId === row.providerId &&
                                existing.accountId === row.accountId),
                    )
                ) {
                    throw new Error('Unique constraint');
                }
                records[model].push({ ...row });

                return { ...row };
            },
            async updateAndCount(data: object) {
                operations.push({ model, operation: 'update' });
                const rows = selected();
                for (const row of rows) {
                    Object.assign(row, data);
                }

                return rows.length;
            },
            async deleteAndCount() {
                operations.push({ model, operation: 'delete' });
                const rows = selected();
                records[model] = records[model].filter((row) => !rows.includes(row));

                return rows.length;
            },
            async aggregate(_selector: (aggregate: { count(): object }) => object) {
                return { total: selected().length };
            },
        };
    };
    const collections = Object.fromEntries(AUTH_MODELS.map((model) => [model, collection(model)])) as Record<
        AuthModel,
        ReturnType<typeof collection>
    >;

    // Snapshot-and-restore stands in for a database transaction: a throwing unit of work leaves no trace.
    const transaction = async <R>(run: (inner: typeof collections) => Promise<R>): Promise<R> => {
        const snapshot = Object.fromEntries(
            Object.entries(records).map(([model, rows]) => [model, rows.map((row) => ({ ...row }))]),
        ) as typeof records;
        try {
            return await run(collections);
        } catch (error) {
            for (const model of Object.keys(records) as AuthModel[]) {
                records[model] = snapshot[model];
            }
            throw error;
        }
    };

    return {
        binding: { database, collections, ...(options.transactions ? { transaction } : {}) },
        records,
        operations,
    };
}
