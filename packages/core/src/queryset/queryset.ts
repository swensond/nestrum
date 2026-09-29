import { AppError } from '#core/application/application.errors';
import { AuthorizationError, PolicyError } from '#core/authorization/authorization.errors';
import { compilePolicyScope } from '#core/authorization/filter';
import type { AuthorizationEngine, PreparedAuthorization } from '#core/authorization/authorization';
import type { AuthorizationEnvironment, QueryOperation, Subject } from '#core/authorization/authorization.types';
import type { RegisteredResource } from '#core/resource/resource.types';
import type { QueryBackend, QueryOrder, QuerySpec, QueryState, QueryWhere } from './queryset.types.js';

type QueryContext = Pick<RegisteredResource, 'identity' | 'metadata' | 'schemas'> & { readonly authorization?: AuthorizationEngine };

export class QuerySetError extends AppError {
    constructor(code: 'QUERY_BACKEND_MISSING' | 'QUERY_ARGUMENT_INVALID' | 'QUERY_NOT_FOUND' | 'QUERY_MULTIPLE_RESULTS' | 'QUERY_OPERATION_UNSUPPORTED' | 'QUERY_MANAGER_INVALID' | 'QUERY_RESULT_INVALID', message: string, options?: ErrorOptions) {
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
    readonly #state: QueryState;

    constructor(context: QueryContext, backend?: QueryBackend<Row, Create, Update, Raw>, state: QueryState = { filters: [], orderBy: [] }) {
        this.#context = context;
        this.#backend = backend;
        this.#state = snapshotQueryValue(state);
        if (new.target === QuerySet) {
            Object.freeze(this);
        }
    }

    authorizedFor(subject: Subject, action: string, environment: AuthorizationEnvironment = {}): this {
        if (!subject || typeof subject !== 'object' || Array.isArray(subject) || !environment || typeof environment !== 'object' || Array.isArray(environment) ||
            typeof action !== 'string' || !action.trim() || action.trim() !== action) {
            throw new AuthorizationError('CONTEXT_INVALID');
        }

        return this.chain({ ...this.#state, authorization: snapshotQueryValue({ subject, action, environment }) });
    }

    filter(where: QueryWhere<Row>): this {
        const parsed = this.#context.schemas.where.parse(snapshotQueryValue(where)) as object;

        return this.chain({ ...this.#state, filters: [...this.#state.filters, parsed] });
    }

    /** Preserve unique identity predicates even when a composed Where schema transforms inputs. */
    filterPrimaryKey(value: unknown): this {
        const keys = this.#context.metadata.fields.filter((field) => field.primaryKey);
        const key = keys[0];
        if (keys.length !== 1 || !key || key.array || value === null || value === undefined) {
            throw new QuerySetError('QUERY_ARGUMENT_INVALID', 'A single scalar primary key is required.');
        }
        const schema = this.#context.schemas.model.shape[key.name];
        if (!schema) { throw new QuerySetError('QUERY_ARGUMENT_INVALID', 'Primary key schema is missing.'); }
        const where = { [key.name]: schema.parse(snapshotQueryValue(value)) };
        this.#context.schemas.where.parse(snapshotQueryValue(where));

        return this.chain({ ...this.#state, filters: [...this.#state.filters, where] });
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
        const { query, permission } = await this.authorize('read');
        if (this.#state.limit === 0) {
            return [];
        }
        const rows = await this.backend().all(query);
        const result = rows.map((row) => this.readResult(row));
        for (const row of result) {
            await permission.checkObject(snapshotQueryValue(row));
        }

        return result;
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
        const { query } = await this.authorize('count');

        return this.backend().count({ filters: query.filters, orderBy: [] });
    }

    async create(data: Create): Promise<Row> {
        const parsed = this.#context.schemas.create.parse(snapshotQueryValue(data)) as Create;
        const { permission } = await this.authorize('create', parsed);
        await permission.checkObject(snapshotQueryValue(parsed));
        const row = await this.backend().create(parsed);

        return this.readResult(row);
    }

    async update(data: Update): Promise<number> {
        this.rejectWindow('update');
        const parsed = this.#context.schemas.update.parse(snapshotQueryValue(data)) as Update;
        const { query } = await this.authorize('update', parsed);

        return this.backend().update({ filters: query.filters, orderBy: [] }, parsed);
    }

    async delete(): Promise<number> {
        this.rejectWindow('delete');
        const { query } = await this.authorize('delete');

        return this.backend().delete({ filters: query.filters, orderBy: [] });
    }

    raw(): Raw {
        return this.backend().raw;
    }

    isDerivedFrom(other: QuerySet<Row, Create, Update, Raw>): boolean {
        return this.#context === other.#context && this.#backend === other.#backend;
    }

    extend<Extended extends QuerySet<Row, Create, Update, Raw>>(type: new (context: QueryContext, backend: QueryBackend<Row, Create, Update, Raw> | undefined, state: QueryState) => Extended): Extended {
        return new type(this.#context, this.#backend, snapshotQueryValue(this.#state));
    }

    protected chain(state: QueryState): this {
        const type = this.constructor as new (context: QueryContext, backend: QueryBackend<Row, Create, Update, Raw> | undefined, state: QueryState) => this;

        return new type(this.#context, this.#backend, state);
    }

    private async authorize(operation: QueryOperation, input?: object): Promise<{ query: QuerySpec; permission: PreparedAuthorization }> {
        const binding = this.#state.authorization;
        if (!binding || !this.#context.authorization) { throw new AuthorizationError('CONTEXT_REQUIRED'); }
        const permission = await this.#context.authorization.prepare(this.#context.identity, snapshotQueryValue(binding), operation, snapshotQueryValue(input));
        const filters = [...this.#state.filters];
        if (permission.scope) {
            const scope = compilePolicyScope(permission.scope, this.#context.metadata.fields.filter((field) => !field.array).map((field) => field.name));
            try {
                this.#context.schemas.where.parse(snapshotQueryValue(scope));
            } catch (cause) {
                throw new PolicyError('POLICY_SCOPE_INVALID', `Policy scope does not validate for ${this.#context.identity}.`, { cause });
            }
            filters.push(scope);
        }

        return { query: snapshotQueryValue({ filters, orderBy: this.#state.orderBy, ...(this.#state.limit === undefined ? {} : { limit: this.#state.limit }) }), permission };
    }

    private rejectWindow(operation: string): void {
        if (this.#state.limit !== undefined) {
            throw new QuerySetError('QUERY_ARGUMENT_INVALID', `${operation}() does not accept a limited QuerySet.`);
        }
    }

    private readResult(row: Row): Row {
        try {
            return this.#context.schemas.read.parse(row) as Row;
        } catch (cause) {
            throw new QuerySetError('QUERY_RESULT_INVALID', `Invalid result for ${this.#context.identity}.`, { cause });
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
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || ['objects', 'managers', 'model', 'database', 'identity', 'api', 'metadata', 'schemas', 'authorization', 'constructor', 'prototype', '__proto__', 'then'].includes(name)) {
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
