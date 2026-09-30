import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { API_KEY_PAGE_SIZE } from './api-keys-shared.js';
import type { AdminFetch } from './metadata.js';

const KEY_SCHEMA = z.object({
    id: z.string().min(1),
    name: z.string(),
    start: z.string(),
    owner: z.object({ type: z.string(), id: z.string() }),
    scopes: z.array(z.string()),
    status: z.enum(['active', 'revoked', 'expired']),
    createdAt: z.string(),
    expiresAt: z.string().nullable(),
    lastUsedAt: z.string().nullable(),
    revokedAt: z.string().nullable(),
    rateLimit: z.object({ enabled: z.boolean(), requests: z.number(), windowSeconds: z.number() }),
});
const PAGE_SCHEMA = z.object({
    keys: z.array(KEY_SCHEMA),
    total: z.number().int().min(0),
    limit: z.number().int().min(1),
    offset: z.number().int().min(0),
});
const REVEAL_SCHEMA = z.object({ key: KEY_SCHEMA, secret: z.string().min(1) });
const CAPABILITIES_SCHEMA = z.object({
    read: z.boolean(),
    create: z.boolean(),
    revoke: z.boolean(),
    rotate: z.boolean(),
});
const ERROR_SCHEMA = z.object({ error: z.object({ code: z.string() }) });

export type ApiKeyRow = z.infer<typeof KEY_SCHEMA>;
export type ApiKeyPage = z.infer<typeof PAGE_SCHEMA>;
export type ApiKeyCapabilities = z.infer<typeof CAPABILITIES_SCHEMA>;
/** The one-time reveal. It exists only in the response to the action that created the key. */
export type RevealedApiKey = { readonly name: string; readonly start: string; readonly secret: string };

export class ApiKeyError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = 'ApiKeyError';
    }
}

/** Fixed, safe messages; response bodies are never echoed to the page. */
function safeMessage(status: number, code: string | undefined): string {
    switch (code) {
        case 'API_KEY_SCOPES_INVALID':
            return 'Scopes must look like projects:read, separated by spaces or commas.';
        case 'API_KEY_OWNER_NOT_FOUND':
            return 'No user has that ID.';
        case 'API_KEY_NOT_ROTATABLE':
            return 'Only active keys can be rotated.';
        case 'API_KEY_NOT_FOUND':
            return 'That key no longer exists.';
        case 'API_KEY_INVALID_INPUT':
            return 'That request is not valid. Check the name, expiry and rate limit.';
        default:
    }
    if (status === 401) {
        return 'Your session has expired. Sign in again.';
    }
    if (status === 403) {
        return 'You do not have permission to do that.';
    }
    if (status === 404) {
        return 'That key no longer exists.';
    }
    if (status === 400) {
        return 'That request is not valid.';
    }

    return 'Unable to complete the request. Please try again.';
}

export class ApiKeyClient {
    constructor(private readonly fetch: AdminFetch) {}

    private async request(path: string, init: RequestInit = {}): Promise<unknown> {
        let response: Response;
        try {
            response = await this.fetch(`/__admin/api-keys${path}`, {
                credentials: 'same-origin',
                cache: 'no-store',
                ...init,
                headers: {
                    accept: 'application/json',
                    ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
                },
            });
        } catch {
            throw new ApiKeyError(503, safeMessage(503, undefined));
        }
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) {
            throw new ApiKeyError(
                response.status,
                safeMessage(response.status, ERROR_SCHEMA.safeParse(payload).data?.error.code),
            );
        }

        return payload;
    }

    /** What the current subject may do; any failure means nothing. */
    async capabilities(): Promise<ApiKeyCapabilities | null> {
        try {
            return CAPABILITIES_SCHEMA.parse(await this.request('/capabilities'));
        } catch {
            return null;
        }
    }

    async list(options: { offset: number }): Promise<ApiKeyPage> {
        const query = new URLSearchParams({ limit: String(API_KEY_PAGE_SIZE), offset: String(options.offset) });
        const parsed = PAGE_SCHEMA.safeParse(await this.request(`?${query}`));
        if (!parsed.success) {
            throw new ApiKeyError(502, safeMessage(502, undefined));
        }

        return parsed.data;
    }

    private reveal(payload: unknown): RevealedApiKey {
        const parsed = REVEAL_SCHEMA.safeParse(payload);
        if (!parsed.success) {
            throw new ApiKeyError(502, safeMessage(502, undefined));
        }

        return { name: parsed.data.key.name, start: parsed.data.key.start, secret: parsed.data.secret };
    }

    async create(body: object): Promise<RevealedApiKey> {
        return this.reveal(await this.request('', { method: 'POST', body: JSON.stringify(body) }));
    }

    async rotate(id: string): Promise<RevealedApiKey> {
        return this.reveal(await this.request(`/${encodeURIComponent(id)}/rotate`, { method: 'POST' }));
    }

    async revoke(id: string): Promise<void> {
        await this.request(`/${encodeURIComponent(id)}/revoke`, { method: 'POST' });
    }
}

export async function loadApiKeyData(fetch: AdminFetch, url: URL) {
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const client = new ApiKeyClient(fetch);
    if (!Number.isInteger(offset) || offset < 0 || offset > 10_000) {
        return { page: null, capabilities: null, message: 'That request is not valid.', offset: 0 };
    }
    const capabilities = await client.capabilities();
    if (!capabilities?.read) {
        return { page: null, capabilities, message: 'You do not have permission to manage API keys.', offset };
    }
    try {
        return { page: await client.list({ offset }), capabilities, message: '', offset };
    } catch (error) {
        return {
            page: null,
            capabilities,
            message: error instanceof ApiKeyError ? error.message : safeMessage(503, undefined),
            offset,
        };
    }
}

function known(error: unknown): ApiKeyError {
    return error instanceof ApiKeyError ? error : new ApiKeyError(503, safeMessage(503, undefined));
}

/** Text inputs only: exactly one value for each allowed name, and nothing else. */
function fields(data: FormData, allowed: readonly string[]): Record<string, string> | null {
    if ([...data.keys()].some((name) => !allowed.includes(name))) {
        return null;
    }
    const values: Record<string, string> = {};
    for (const name of allowed) {
        const all = data.getAll(name);
        if (all.length > 1 || (all[0] !== undefined && typeof all[0] !== 'string')) {
            return null;
        }
        if (typeof all[0] === 'string') {
            values[name] = all[0].trim();
        }
    }

    return values;
}

function positiveInteger(value: string | undefined): number | undefined | null {
    if (value === undefined || value === '') {
        return undefined;
    }

    return /^[1-9][0-9]{0,9}$/.test(value) ? Number(value) : null;
}

const invalid = () => fail(400, { message: 'That request is not valid.' });
const NO_STORE = { 'cache-control': 'no-store' };

/** Native-form action. The revealed secret is returned in this response only, never stored or redirected. */
export async function createKey(event: {
    fetch: AdminFetch;
    request: Request;
    setHeaders(headers: Record<string, string>): void;
}) {
    const input = fields(await event.request.formData(), [
        'name',
        'ownerId',
        'scopes',
        'expiresInDays',
        'rateLimitRequests',
        'rateLimitWindowSeconds',
        'rateLimitDisabled',
    ]);
    if (!input?.name || !input.ownerId || input.name.length > 64 || input.ownerId.length > 128) {
        return invalid();
    }
    const expiresInDays = positiveInteger(input.expiresInDays);
    const requests = positiveInteger(input.rateLimitRequests);
    const windowSeconds = positiveInteger(input.rateLimitWindowSeconds);
    if (
        expiresInDays === null ||
        requests === null ||
        windowSeconds === null ||
        (input.rateLimitDisabled !== undefined && input.rateLimitDisabled !== 'on') ||
        (input.scopes ?? '').length > 4096
    ) {
        return invalid();
    }
    const scopes = (input.scopes ?? '').split(/[\s,]+/).filter(Boolean);
    event.setHeaders(NO_STORE);
    try {
        const revealed = await new ApiKeyClient(event.fetch).create({
            name: input.name,
            ownerId: input.ownerId,
            scopes,
            ...(expiresInDays === undefined ? {} : { expiresInDays }),
            ...(input.rateLimitDisabled === 'on' || requests !== undefined || windowSeconds !== undefined
                ? {
                      rateLimit: {
                          ...(input.rateLimitDisabled === 'on' ? { enabled: false } : {}),
                          ...(requests === undefined ? {} : { requests }),
                          ...(windowSeconds === undefined ? {} : { windowSeconds }),
                      },
                  }
                : {}),
        });

        return { revealed, message: '' };
    } catch (error) {
        const failure = known(error);

        return fail(failure.status, { message: failure.message });
    }
}

/** Shared by revoke and rotate: exactly one key id. */
async function keyId(request: Request): Promise<string | null> {
    const data = await request.formData();
    const id = data.get('keyId');
    if (
        typeof id !== 'string' ||
        !id ||
        id.length > 128 ||
        data.getAll('keyId').length !== 1 ||
        [...data.keys()].some((name) => name !== 'keyId')
    ) {
        return null;
    }

    return id;
}

export async function revokeKey(event: { fetch: AdminFetch; request: Request }) {
    const id = await keyId(event.request);
    if (id === null) {
        return invalid();
    }
    try {
        await new ApiKeyClient(event.fetch).revoke(id);
    } catch (error) {
        const failure = known(error);

        return fail(failure.status, { message: failure.message });
    }

    return { revoked: true, message: '' };
}

export async function rotateKey(event: {
    fetch: AdminFetch;
    request: Request;
    setHeaders(headers: Record<string, string>): void;
}) {
    const id = await keyId(event.request);
    if (id === null) {
        return invalid();
    }
    event.setHeaders(NO_STORE);
    try {
        return { revealed: await new ApiKeyClient(event.fetch).rotate(id), message: '' };
    } catch (error) {
        const failure = known(error);

        return fail(failure.status, { message: failure.message });
    }
}
