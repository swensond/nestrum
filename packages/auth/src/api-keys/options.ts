import { AppError } from '@nestrum/core';

/** Framework settings for the Better Auth API-key plugin. Every field has a safe default. */
export type ApiKeyOptions = {
    /** Recognizable key prefix, for example `nes_live_` or `nes_test_`. Defaults to `nes_live_`. */
    readonly prefix?: string;
    /** Lifetime given to keys created without an explicit expiry. Omit for no default expiry. */
    readonly defaultTtlDays?: number;
    /** Longest lifetime an explicit expiry may request. Defaults to 365. */
    readonly maxTtlDays?: number;
    /** Default per-key rate limit; each key may override it at creation. Defaults to 1000 requests per 60 seconds. */
    readonly rateLimit?: {
        readonly enabled?: boolean;
        readonly requests?: number;
        readonly windowSeconds?: number;
    };
};
export type ResolvedApiKeyOptions = {
    readonly prefix: string;
    readonly defaultTtlDays: number | null;
    readonly maxTtlDays: number;
    readonly rateLimit: { readonly enabled: boolean; readonly requests: number; readonly windowSeconds: number };
};

/** Better Auth stores windows in milliseconds in a 32-bit column. */
export const MAX_WINDOW_SECONDS = 2_147_483;
export const MAX_REQUESTS = 2_000_000_000;

function integer(value: unknown, min: number, max: number): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

export function resolveApiKeyOptions(input: ApiKeyOptions | undefined): ResolvedApiKeyOptions {
    if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input))) {
        throw new AppError('AUTH_CONFIG_INVALID', 'apiKeys must be an options object.');
    }
    const { prefix = 'nes_live_', defaultTtlDays, maxTtlDays = 365, rateLimit = {} } = input ?? {};
    const { enabled = true, requests = 1000, windowSeconds = 60 } = rateLimit ?? {};
    if (
        typeof prefix !== 'string' ||
        !/^[a-z][a-z0-9_]{1,30}_$/.test(prefix) ||
        !integer(maxTtlDays, 1, 3650) ||
        (defaultTtlDays !== undefined && !integer(defaultTtlDays, 1, maxTtlDays)) ||
        typeof enabled !== 'boolean' ||
        !integer(requests, 1, MAX_REQUESTS) ||
        !integer(windowSeconds, 1, MAX_WINDOW_SECONDS)
    ) {
        throw new AppError(
            'AUTH_CONFIG_INVALID',
            'apiKeys needs a lowercase prefix ending in an underscore, TTL days within the maximum, and positive integer rate-limit settings.',
        );
    }

    return Object.freeze({
        prefix,
        defaultTtlDays: defaultTtlDays ?? null,
        maxTtlDays,
        rateLimit: Object.freeze({ enabled, requests, windowSeconds }),
    });
}
