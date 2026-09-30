import type {
    ApiKeyPage,
    ApiKeyPrincipal,
    ApiKeySummary,
    ApiKeys,
    CreateApiKeyInput,
    CreatedApiKey,
    RotatedApiKey,
} from '@nestrum/core';
import { API_KEY_HEADER, ApiKeyError, AppError, isApiKeyScope, parseApiKeyScopes } from '@nestrum/core';
import type { createAuthInstance } from '#auth/auth';
import type { ResolvedApiKeyOptions } from './options.js';
import { MAX_REQUESTS, MAX_WINDOW_SECONDS } from './options.js';

type AuthInstance = ReturnType<typeof createAuthInstance>;
type Row = Record<string, unknown> & { id: string; referenceId: string };

/** Keys Nestrum writes into Better Auth's key metadata; callers cannot set them. */
const RESERVED_METADATA = ['revokedAt', 'rotatedFromId', 'rotatedToId'] as const;
const MAX_METADATA_BYTES = 4096;
/** Printable, whitespace-free credentials only; bounds the work done for arbitrary header input. */
const CREDENTIAL = /^[\x21-\x7e]{16,256}$/;
const MODEL = 'apikey';

function instant(value: unknown): string | null {
    const time = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : Number.NaN;

    return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function record(value: unknown): Record<string, unknown> {
    let parsed = value;
    for (let depth = 0; typeof parsed === 'string' && depth < 2; depth += 1) {
        try {
            parsed = JSON.parse(parsed);
        } catch {
            return {};
        }
    }

    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

/** Better Auth stores permissions as `{ resource: [action] }`; Nestrum scopes are `resource:action`. */
function toPermissions(scopes: readonly string[]): Record<string, string[]> {
    const permissions: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
    for (const scope of scopes) {
        const [resource, action] = scope.split(':') as [string, string];
        permissions[resource] = [...(permissions[resource] ?? []), action];
    }

    return permissions;
}

export function scopesOf(row: Record<string, unknown>): readonly string[] {
    const scopes: string[] = [];
    for (const [resource, actions] of Object.entries(record(row.permissions))) {
        for (const action of Array.isArray(actions) ? actions : []) {
            const scope = `${resource}:${String(action)}`;
            if (isApiKeyScope(scope)) {
                scopes.push(scope);
            }
        }
    }

    return Object.freeze([...new Set(scopes)].sort());
}

export function summarize(row: Row, now = Date.now()): ApiKeySummary {
    const metadata = record(row.metadata);
    const expiresAt = instant(row.expiresAt);
    const revokedAt =
        row.enabled === false
            ? (instant(metadata.revokedAt) ?? instant(row.updatedAt) ?? instant(row.createdAt))
            : null;
    const visible = Object.fromEntries(
        Object.entries(metadata).filter(([name]) => !(RESERVED_METADATA as readonly string[]).includes(name)),
    );

    return Object.freeze({
        id: row.id,
        name: typeof row.name === 'string' ? row.name : '',
        start: typeof row.start === 'string' ? row.start : '',
        owner: Object.freeze({ type: 'user' as const, id: row.referenceId }),
        scopes: scopesOf(row),
        status:
            revokedAt !== null
                ? ('revoked' as const)
                : expiresAt !== null && Date.parse(expiresAt) <= now
                  ? ('expired' as const)
                  : ('active' as const),
        createdAt: instant(row.createdAt) ?? '',
        expiresAt,
        lastUsedAt: instant(row.lastRequest),
        revokedAt,
        rateLimit: Object.freeze({
            enabled: row.rateLimitEnabled !== false,
            requests: typeof row.rateLimitMax === 'number' ? row.rateLimitMax : 0,
            windowSeconds: typeof row.rateLimitTimeWindow === 'number' ? Math.round(row.rateLimitTimeWindow / 1000) : 0,
        }),
        metadata: Object.freeze(visible),
    });
}

function invalidInput(message: string): AppError {
    return new AppError('API_KEY_INVALID_INPUT', message, 400);
}

/** Better Auth failures that reach callers become safe, status-carrying errors; their messages are not echoed. */
function failure(error: unknown): never {
    if (error instanceof AppError) {
        throw error;
    }
    const status = (error as { statusCode?: unknown; status?: unknown } | null)?.statusCode;
    if (status === 404) {
        throw new AppError('API_KEY_NOT_FOUND', 'API key not found.', 404, { cause: error });
    }
    if (status === 400) {
        throw new AppError('API_KEY_INVALID_INPUT', 'The API key request is not valid.', 400, { cause: error });
    }
    throw error;
}

type Verification = {
    valid: boolean;
    error: { code?: string; details?: { tryAgainIn?: number } } | null;
    key: Row | null;
};

export function createApiKeys(instance: AuthInstance, options: ResolvedApiKeyOptions): ApiKeys {
    const context = () => instance.$context;

    async function find(id: unknown): Promise<Row> {
        if (typeof id !== 'string' || !id || id.length > 128) {
            throw new AppError('API_KEY_NOT_FOUND', 'API key not found.', 404);
        }
        const row = (await (
            await context()
        ).adapter.findOne({
            model: MODEL,
            where: [{ field: 'id', value: id }],
        })) as Row | null;
        if (!row) {
            throw new AppError('API_KEY_NOT_FOUND', 'API key not found.', 404);
        }

        return row;
    }

    async function requireOwner(ownerId: unknown): Promise<string> {
        if (typeof ownerId !== 'string' || !ownerId || ownerId.length > 128) {
            throw invalidInput('An API key needs an owner user id.');
        }
        if (!(await (await context()).internalAdapter.findUserById(ownerId))) {
            throw new AppError('API_KEY_OWNER_NOT_FOUND', 'The key owner does not exist.', 404);
        }

        return ownerId;
    }

    function validate(input: CreateApiKeyInput) {
        if (!input || typeof input !== 'object') {
            throw invalidInput('An API key request must be an object.');
        }
        const name = typeof input.name === 'string' ? input.name.trim() : '';
        if (!name || name.length > 64) {
            throw invalidInput('An API key needs a name of 1 to 64 characters.');
        }
        const scopes = parseApiKeyScopes(input.scopes);
        if (
            input.expiresInDays !== undefined &&
            (!Number.isInteger(input.expiresInDays) ||
                input.expiresInDays < 1 ||
                input.expiresInDays > options.maxTtlDays)
        ) {
            throw invalidInput(`Expiry must be a whole number of days from 1 to ${options.maxTtlDays}.`);
        }
        const limit = input.rateLimit;
        if (
            limit !== undefined &&
            (!limit ||
                typeof limit !== 'object' ||
                (limit.enabled !== undefined && typeof limit.enabled !== 'boolean') ||
                (limit.requests !== undefined &&
                    (!Number.isInteger(limit.requests) || limit.requests < 1 || limit.requests > MAX_REQUESTS)) ||
                (limit.windowSeconds !== undefined &&
                    (!Number.isInteger(limit.windowSeconds) ||
                        limit.windowSeconds < 1 ||
                        limit.windowSeconds > MAX_WINDOW_SECONDS)))
        ) {
            throw invalidInput('Rate limits need positive whole-number requests and windowSeconds.');
        }
        const metadata = input.metadata ?? {};
        if (
            !metadata ||
            typeof metadata !== 'object' ||
            Array.isArray(metadata) ||
            RESERVED_METADATA.some((name) => Object.hasOwn(metadata, name)) ||
            JSON.stringify(metadata).length > MAX_METADATA_BYTES
        ) {
            throw invalidInput('Key metadata must be a small object without reserved names.');
        }

        return { name, scopes, limit, metadata, expiresInDays: input.expiresInDays };
    }

    async function issue(
        ownerId: string,
        fields: ReturnType<typeof validate>,
        extraMetadata: Record<string, unknown> = {},
    ): Promise<CreatedApiKey> {
        let created: Record<string, unknown> & { id: string; referenceId: string; key: string };
        try {
            created = (await instance.api.createApiKey({
                body: {
                    name: fields.name,
                    userId: ownerId,
                    permissions: toPermissions(fields.scopes),
                    metadata: { ...fields.metadata, ...extraMetadata },
                    ...(fields.expiresInDays === undefined ? {} : { expiresIn: fields.expiresInDays * 86_400 }),
                    ...(fields.limit?.enabled === undefined ? {} : { rateLimitEnabled: fields.limit.enabled }),
                    ...(fields.limit?.requests === undefined ? {} : { rateLimitMax: fields.limit.requests }),
                    ...(fields.limit?.windowSeconds === undefined
                        ? {}
                        : { rateLimitTimeWindow: fields.limit.windowSeconds * 1000 }),
                },
            })) as typeof created;
        } catch (error) {
            return failure(error);
        }
        const { key: secret, ...row } = created;

        return Object.freeze({ key: summarize(row as Row), secret });
    }

    async function setEnabled(row: Row, enabled: boolean, extra: Record<string, unknown>): Promise<Row> {
        const metadata = { ...record(row.metadata), ...extra };
        if (enabled) {
            delete metadata.revokedAt;
        }
        try {
            return (await instance.api.updateApiKey({
                body: { keyId: row.id, userId: row.referenceId, enabled, metadata },
            })) as unknown as Row;
        } catch (error) {
            return failure(error);
        }
    }

    function reject(verification: Verification): never {
        switch (verification.error?.code) {
            case 'KEY_EXPIRED':
                throw ApiKeyError.unauthenticated('API_KEY_EXPIRED', 'The API key has expired.');
            case 'KEY_DISABLED':
                throw ApiKeyError.unauthenticated('API_KEY_REVOKED', 'The API key has been revoked.');
            case 'RATE_LIMITED':
            case 'USAGE_EXCEEDED': {
                const retry = Math.max(1, Math.ceil((verification.error.details?.tryAgainIn ?? 1000) / 1000));
                throw new ApiKeyError('API_KEY_RATE_LIMITED', 'The API key has exceeded its rate limit.', 429, {
                    'Retry-After': String(retry),
                });
            }
            default:
                throw ApiKeyError.unauthenticated('API_KEY_INVALID', 'The API key is not valid.');
        }
    }

    return Object.freeze({
        async authenticate(request: Request): Promise<ApiKeyPrincipal | null> {
            const credential = request.headers.get(API_KEY_HEADER);
            if (credential === null) {
                return null;
            }
            if (!CREDENTIAL.test(credential)) {
                throw ApiKeyError.unauthenticated('API_KEY_INVALID', 'The API key is not valid.');
            }
            // The plugin hashes the credential, rejects disabled and expired keys and atomically consumes the rate
            // limit. A failed check writes nothing, so failures never touch last-use metadata.
            const verification = (await instance.api.verifyApiKey({
                body: { key: credential },
            })) as unknown as Verification;
            if (!verification.valid || !verification.key) {
                return reject(verification);
            }
            const row = verification.key;
            const owner = (await (await context()).internalAdapter.findUserById(row.referenceId)) as {
                banned?: unknown;
            } | null;
            if (!owner || owner.banned === true) {
                throw ApiKeyError.unauthenticated('API_KEY_INVALID', 'The API key is not valid.');
            }

            return Object.freeze({
                id: row.id,
                name: typeof row.name === 'string' ? row.name : null,
                owner: Object.freeze({ type: 'user' as const, id: row.referenceId }),
                scopes: scopesOf(row),
            });
        },

        async create(input: CreateApiKeyInput): Promise<CreatedApiKey> {
            const fields = validate(input);

            return issue(await requireOwner(input.ownerId), fields);
        },

        async list(query): Promise<ApiKeyPage> {
            if (
                !Number.isInteger(query.limit) ||
                query.limit < 1 ||
                query.limit > 100 ||
                !Number.isInteger(query.offset) ||
                query.offset < 0 ||
                query.offset > 10_000 ||
                (query.ownerId !== undefined && (typeof query.ownerId !== 'string' || query.ownerId.length > 128))
            ) {
                throw invalidInput('Invalid API key list window.');
            }
            const where = query.ownerId === undefined ? [] : [{ field: 'referenceId', value: query.ownerId }];
            const { adapter } = await context();
            const [rows, total] = await Promise.all([
                adapter.findMany({
                    model: MODEL,
                    where,
                    limit: query.limit,
                    offset: query.offset,
                    sortBy: { field: 'createdAt', direction: 'desc' },
                }) as Promise<Row[]>,
                adapter.count({ model: MODEL, where }),
            ]);

            return Object.freeze({
                keys: Object.freeze(rows.map((row) => summarize(row))),
                total,
                limit: query.limit,
                offset: query.offset,
            });
        },

        async revoke(id: string): Promise<ApiKeySummary> {
            const row = await find(id);
            if (row.enabled === false) {
                return summarize(row);
            }

            return summarize(await setEnabled(row, false, { revokedAt: new Date().toISOString() }));
        },

        async rotate(id: string): Promise<RotatedApiKey> {
            const row = await find(id);
            const current = summarize(row);
            if (current.status !== 'active') {
                throw new AppError(
                    'API_KEY_NOT_ROTATABLE',
                    `Only active keys can be rotated; this key is ${current.status}.`,
                    409,
                );
            }
            const lifetimeSeconds =
                current.expiresAt === null
                    ? null
                    : (Date.parse(current.expiresAt) - Date.parse(current.createdAt)) / 1000;
            const replacement = await issue(
                row.referenceId,
                {
                    name: current.name,
                    scopes: current.scopes,
                    limit: current.rateLimit,
                    metadata: current.metadata,
                    expiresInDays:
                        lifetimeSeconds === null
                            ? undefined
                            : Math.min(options.maxTtlDays, Math.max(1, Math.ceil(lifetimeSeconds / 86_400))),
                },
                { rotatedFromId: row.id },
            );
            let revoked: Row;
            try {
                revoked = await setEnabled(row, false, {
                    revokedAt: new Date().toISOString(),
                    rotatedToId: replacement.key.id,
                });
            } catch (error) {
                // Storage has no transactions: never leave two live keys behind a failed rotation.
                await find(replacement.key.id)
                    .then((created) => setEnabled(created, false, { revokedAt: new Date().toISOString() }))
                    .catch(() => undefined);
                throw error;
            }

            return Object.freeze({ ...replacement, revoked: summarize(revoked) });
        },
    });
}
