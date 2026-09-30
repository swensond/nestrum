import { AppError } from '#core/application/application.errors';
import type { Subject } from '#core/authorization/authorization.types';

/** How a request to a resource's public API may authenticate. */
export type ResourceAuthMode = 'session' | 'api-key';
export const RESOURCE_AUTH_MODES = Object.freeze(['session', 'api-key'] as const);
/** The `type` attribute carried by every API-key subject, so policies can tell keys from human sessions. */
export const API_KEY_SUBJECT_TYPE = 'api-key';
/** Canonical credential transport: `X-API-Key: <key>`. Keys are never read from query strings or cookies. */
export const API_KEY_HEADER = 'x-api-key';

/** `resource:action`, for example `projects:read`. `projects:*` grants every action on one resource prefix. */
const SCOPE_PATTERN = /^[a-z][a-z0-9-]{0,63}:(?:[a-z][a-z0-9_-]{0,63}|\*)$/;
export const MAX_API_KEY_SCOPES = 64;

export function isApiKeyScope(value: unknown): value is string {
    return typeof value === 'string' && SCOPE_PATTERN.test(value);
}

/** Validate caller-supplied scopes (create/rotate). Anything malformed is rejected, never normalized away. */
export function parseApiKeyScopes(value: unknown): readonly string[] {
    if (!Array.isArray(value) || value.length > MAX_API_KEY_SCOPES || !value.every(isApiKeyScope)) {
        throw new AppError(
            'API_KEY_SCOPES_INVALID',
            'Scopes must be an array of resource:action strings such as projects:read.',
            400,
        );
    }

    return Object.freeze([...new Set(value as string[])].sort());
}

/**
 * Whether granted scopes satisfy a required one. Fails closed: a malformed required scope or malformed grants never
 * match, and only an exact value or the same prefix's `:*` wildcard grants access.
 */
export function scopesSatisfy(granted: unknown, required: string): boolean {
    if (!isApiKeyScope(required) || required.endsWith(':*') || !Array.isArray(granted)) {
        return false;
    }
    const wildcard = `${required.slice(0, required.indexOf(':'))}:*`;

    return granted.some((scope) => isApiKeyScope(scope) && (scope === required || scope === wildcard));
}

/** The authenticated identity behind a verified API key. It is never a user and never a browser session. */
export type ApiKeyPrincipal = {
    readonly id: string;
    readonly name: string | null;
    readonly owner: { readonly type: 'user'; readonly id: string };
    readonly scopes: readonly string[];
};

/** Explicit ABAC subject for an API key. Has no `role`: key authority comes from scopes plus policies. */
export function apiKeySubject(principal: ApiKeyPrincipal): Subject {
    return Object.freeze({
        id: principal.id,
        anonymous: false,
        type: API_KEY_SUBJECT_TYPE,
        owner: Object.freeze({ ...principal.owner }),
        scopes: Object.freeze(principal.scopes.filter(isApiKeyScope)),
    });
}

export type ApiKeyErrorCode =
    | 'API_KEY_INVALID'
    | 'API_KEY_EXPIRED'
    | 'API_KEY_REVOKED'
    | 'API_KEY_RATE_LIMITED'
    | 'API_KEY_NOT_ACCEPTED'
    | 'API_KEY_REQUIRED'
    | 'API_KEY_SCOPE_DENIED';

/** Safe, status-carrying failure. Messages are fixed text; a supplied credential is never echoed. */
export class ApiKeyError extends AppError {
    constructor(
        code: ApiKeyErrorCode,
        message: string,
        status: 401 | 403 | 429,
        public readonly headers: Readonly<Record<string, string>> = {},
        options?: ErrorOptions,
    ) {
        super(code, message, status, options);
        this.name = 'ApiKeyError';
    }

    static unauthenticated(code: ApiKeyErrorCode, message: string, cause?: unknown): ApiKeyError {
        return new ApiKeyError(code, message, 401, { 'WWW-Authenticate': 'X-API-Key' }, { cause });
    }
}

export type ApiKeyRateLimit = {
    readonly enabled: boolean;
    readonly requests: number;
    readonly windowSeconds: number;
};
/** Key metadata that is safe to return after creation. The secret and its hash are never part of it. */
export type ApiKeySummary = {
    readonly id: string;
    readonly name: string;
    /** First characters of the key, including the prefix, for recognition in a list. */
    readonly start: string;
    readonly owner: { readonly type: 'user'; readonly id: string };
    readonly scopes: readonly string[];
    readonly status: 'active' | 'revoked' | 'expired';
    readonly createdAt: string;
    readonly expiresAt: string | null;
    readonly lastUsedAt: string | null;
    /** Set when the key was revoked; revoked keys are kept and never authenticate again. */
    readonly revokedAt: string | null;
    readonly rateLimit: ApiKeyRateLimit;
    readonly metadata: Readonly<Record<string, unknown>>;
};
export type ApiKeyPage = {
    readonly keys: readonly ApiKeySummary[];
    readonly total: number;
    readonly limit: number;
    readonly offset: number;
};
export type CreateApiKeyInput = {
    readonly name: string;
    readonly ownerId: string;
    readonly scopes: readonly string[];
    /** Lifetime in days; omitted uses the framework default, which may be no expiry. */
    readonly expiresInDays?: number;
    readonly rateLimit?: { readonly [K in keyof ApiKeyRateLimit]?: ApiKeyRateLimit[K] | undefined };
    readonly metadata?: Readonly<Record<string, unknown>>;
};
/** The only place a complete key exists: returned once on creation or rotation, never stored. */
export type CreatedApiKey = {
    readonly key: ApiKeySummary;
    readonly secret: string;
};
export type RotatedApiKey = CreatedApiKey & { readonly revoked: ApiKeySummary };

/** Framework-owned key management and request authentication backed by Better Auth's API-key plugin. */
export type ApiKeys = {
    /** `null` when the request carries no key; throws {@link ApiKeyError} for an unusable one. */
    authenticate(request: Request): Promise<ApiKeyPrincipal | null>;
    create(input: CreateApiKeyInput): Promise<CreatedApiKey>;
    list(query: { readonly limit: number; readonly offset: number; readonly ownerId?: string }): Promise<ApiKeyPage>;
    revoke(id: string): Promise<ApiKeySummary>;
    /** Creates a replacement with the same configuration, reveals it once, then revokes the predecessor. */
    rotate(id: string): Promise<RotatedApiKey>;
};
