import { AppError } from '#core/application/application.errors';
import type { RegisteredResource } from '#core/resource/resource.types';
import type { QueryBackend, QueryOrder, QuerySpec, QueryWhere } from './queryset.types.js';

type QueryContext = Pick<RegisteredResource, 'identity' | 'metadata' | 'schemas'>;

export class QuerySetError extends AppError {
    constructor(code: 'QUERY_BACKEND_MISSING' | 'QUERY_ARGUMENT_INVALID' | 'QUERY_NOT_FOUND' | 'QUERY_MULTIPLE_RESULTS' | 'QUERY_OPERATION_UNSUPPORTED' | 'QUERY_MANAGER_INVALID', message: string, options?: ErrorOptions) {
        super(code, message, code === 'QUERY_NOT_FOUND' ? 404 : code === 'QUERY_ARGUMENT_INVALID' || code === 'QUERY_OPERATION_UNSUPPORTED' ? 400 : 500, options);
        this.name = 'QuerySetError';
    }
}

export function snapshotQueryValue<T>(value: T, ancestors = new Set<object>()): T {
    if (value === null || typeof value !== 'object') {
        return value;
    }
    if (value instanceof Date) {
        return new Date(value.getTime()) as T;
    }
    if (ancestors.has(value)) {
        throw new QuerySetError('QUERY_ARGUMENT_INVALID', 'Query input must not contain cycles.');
    }
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
        return value;
    }
    ancestors.add(value);
    const copied = Array.isArray(value) ? value.map((entry) => snapshotQueryValue(entry, ancestors)) :
        Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, snapshotQueryValue(entry, ancestors)]));
    ancestors.delete(value);

    return copied as T;
}

export class QuerySet<Row extends object = Record<string, unknown>, Create extends object = Partial<Row>, Update extends object = Partial<Row>, Raw = unknown> {
    readonly #context: QueryContext;
    readonly #backend: QueryBackend<Row, Create, Update, Raw> | undefined;
    readonly #state: QuerySpec;

    constructor(context: QueryContext, backend?: QueryBackend<Row, Create, Update, Raw>, state: QuerySpec = { filters: [], orderBy: [] }) {
        this.#context = context;
        this.#backend = backend;
        this.#state = snapshotQueryValue(state);
        if (new.target === QuerySet) {
            Object.freeze(this);
        }
    }

    filter(where: QueryWhere<Row>): this {
        const parsed = this.#context.schemas.where.parse(snapshotQueryValue(where)) as object;

        return this.chain({ ...this.#state, filters: [...this.#state.filters, parsed] });
    }

    orderBy(...fields: (Extract<keyof Row, string> | `-${Extract<keyof Row, string>}`)[]): this {
        const orderBy: QueryOrder[] = fields.map((input) => {
            const direction = input.startsWith('-') ? 'desc' : 'asc';
            const field = direction === 'desc' ? input.slice(1) : input;
            if (!this.#context.metadata.fields.some((candidate) => candidate.name === field && !candidate.array)) {
                throw new QuerySetError('QUERY_ARGUMENT_INVALID', `Cannot order ${this.#context.identity} by ${field}.`);
            }
            this.#context.schemas.orderBy.parse({ [field]: direction });

            return { field, direction };
        });

        return this.chain({ ...this.#state, orderBy });
    }

    limit(limit: number): this {
        if (!Number.isSafeInteger(limit) || limit < 0) {
            throw new QuerySetError('QUERY_ARGUMENT_INVALID', 'Query limit must be a nonnegative safe integer.');
        }

        return this.chain({ ...this.#state, limit });
    }

    async all(): Promise<Row[]> {
        if (this.#state.limit === 0) {
            return [];
        }
        const rows = await this.backend().all(snapshotQueryValue(this.#state));

        return rows.map((row) => this.#context.schemas.read.parse(row) as Row);
    }

    async first(): Promise<Row | null> {
        const rows = await this.limit(Math.min(this.#state.limit ?? 1, 1)).all();

        return rows[0] ?? null;
    }

    async get(where?: QueryWhere<Row>): Promise<Row> {
        this.rejectWindow('get');
        const rows = await (where === undefined ? this : this.filter(where)).limit(2).all();
        if (rows.length === 0) {
            throw new QuerySetError('QUERY_NOT_FOUND', `No matching ${this.#context.identity} record.`);
        }
        if (rows.length > 1) {
            throw new QuerySetError('QUERY_MULTIPLE_RESULTS', `Multiple matching ${this.#context.identity} records.`);
        }

        return rows[0]!;
    }

    async exists(): Promise<boolean> {
        return await this.first() !== null;
    }

    async count(): Promise<number> {
        return this.backend().count(snapshotQueryValue({ filters: this.#state.filters, orderBy: [] }));
    }

    async create(data: Create): Promise<Row> {
        const parsed = this.#context.schemas.create.parse(snapshotQueryValue(data)) as Create;
        const row = await this.backend().create(parsed);

        return this.#context.schemas.read.parse(row) as Row;
    }

    async update(data: Update): Promise<number> {
        this.rejectWindow('update');
        const parsed = this.#context.schemas.update.parse(snapshotQueryValue(data)) as Update;

        return this.backend().update(snapshotQueryValue({ filters: this.#state.filters, orderBy: [] }), parsed);
    }

    async delete(): Promise<number> {
        this.rejectWindow('delete');

        return this.backend().delete(snapshotQueryValue({ filters: this.#state.filters, orderBy: [] }));
    }

    raw(): Raw {
        return this.backend().raw;
    }

    isDerivedFrom(other: QuerySet<Row, Create, Update, Raw>): boolean {
        return this.#context === other.#context && this.#backend === other.#backend;
    }

    extend<Extended extends QuerySet<Row, Create, Update, Raw>>(type: new (context: QueryContext, backend: QueryBackend<Row, Create, Update, Raw> | undefined, state: QuerySpec) => Extended): Extended {
        return new type(this.#context, this.#backend, snapshotQueryValue(this.#state));
    }

    protected chain(state: QuerySpec): this {
        const type = this.constructor as new (context: QueryContext, backend: QueryBackend<Row, Create, Update, Raw> | undefined, state: QuerySpec) => this;

        return new type(this.#context, this.#backend, state);
    }

    private rejectWindow(operation: string): void {
        if (this.#state.limit !== undefined) {
            throw new QuerySetError('QUERY_ARGUMENT_INVALID', `${operation}() does not accept a limited QuerySet.`);
        }
    }

    private backend(): QueryBackend<Row, Create, Update, Raw> {
        if (!this.#backend) {
            throw new QuerySetError('QUERY_BACKEND_MISSING', `No Prisma query backend is bound to ${this.#context.identity}.`);
        }

        return this.#backend;
    }
}

export function bindResourceQuerySets<Row extends object, Create extends object, Update extends object, Raw, Managers extends Record<string, (query: QuerySet<Row, Create, Update, Raw>) => QuerySet<Row, Create, Update, Raw>>>(
    resource: QueryContext, backend: QueryBackend<Row, Create, Update, Raw> | undefined, managers: Managers
): { readonly objects: QuerySet<Row, Create, Update, Raw> } & { readonly [Key in keyof Managers]: ReturnType<Managers[Key]> } {
    const objects = new QuerySet(resource, backend);
    const result: Record<string, QuerySet<Row, Create, Update, Raw>> = { objects };
    for (const [name, factory] of Object.entries(managers)) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || ['objects', 'managers', 'model', 'database', 'identity', 'api', 'metadata', 'schemas', 'constructor', 'prototype', '__proto__', 'then'].includes(name)) {
            throw new QuerySetError('QUERY_MANAGER_INVALID', `Invalid or reserved manager name ${name}.`);
        }
        let manager: QuerySet<Row, Create, Update, Raw>;
        try {
            manager = factory(objects);
        } catch (cause) {
            throw new QuerySetError('QUERY_MANAGER_INVALID', `Manager ${name} failed to initialize for ${resource.identity}.`, { cause });
        }
        if (!(manager instanceof QuerySet) || !manager.isDerivedFrom(objects)) {
            throw new QuerySetError('QUERY_MANAGER_INVALID', `Manager ${name} must return a QuerySet derived from this resource's objects manager.`);
        }
        result[name] = manager;
    }

    return Object.freeze(result) as { readonly objects: QuerySet<Row, Create, Update, Raw> } & { readonly [Key in keyof Managers]: ReturnType<Managers[Key]> };
}
