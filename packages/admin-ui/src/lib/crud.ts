import type { AdminResourceMetadata } from '@nestrum/admin';
import { z } from 'zod';
import type { AdminFetch } from './metadata.js';
import { resourceHref } from './routes.js';

export type AdminRecord = Record<string, unknown>;
export type FieldErrors = Record<string, string[]>;
const RECORD_SCHEMA = z.record(z.string(), z.unknown());
const ERROR_SCHEMA = z.object({
    error: z.object({
        issues: z.array(z.object({ path: z.array(z.union([z.string(), z.number()])), message: z.string() })).optional(),
    }),
});

export class AdminCrudError extends Error {
    constructor(
        readonly status: number,
        message: string,
        readonly fields: FieldErrors = {},
    ) {
        super(message);
        this.name = 'AdminCrudError';
    }
}

export function recordHref(resource: AdminResourceMetadata, record: AdminRecord): string | null {
    const id = record[resource.primaryKey];
    if (!['string', 'number', 'boolean'].includes(typeof id) || String(id) === '' || ['.', '..'].includes(String(id))) {
        return null;
    }

    const text = String(id);
    const segment = text === 'new' || text.startsWith('~') ? `~${text}` : text;

    return `${resourceHref(resource)}/${encodeURIComponent(segment)}`;
}

export function recordId(segment: string): string {
    return segment.startsWith('~') ? segment.slice(1) : segment;
}

function safeMessage(status: number): string {
    switch (status) {
        case 400:
            return 'Check the highlighted fields and try again.';
        case 401:
            return 'Your session has expired. Sign in again.';
        case 403:
            return 'You do not have permission to perform this operation.';
        case 404:
            return 'The record is unavailable or no longer exists.';
        default:
            return 'Unable to complete the request. Please try again.';
    }
}

export class AdminResourceClient {
    constructor(private readonly fetch: AdminFetch = globalThis.fetch) {}

    private async request(
        resource: AdminResourceMetadata,
        method: string,
        id?: string,
        body?: AdminRecord,
        query = '',
    ): Promise<Response> {
        let response: Response;
        try {
            response = await this.fetch(
                `/__admin/${encodeURIComponent(resource.slug)}${id === undefined ? '' : `/${encodeURIComponent(id)}`}${query}`,
                {
                    method,
                    credentials: 'same-origin',
                    cache: 'no-store',
                    headers: {
                        accept: 'application/json',
                        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
                    },
                    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
                },
            );
        } catch {
            throw new AdminCrudError(503, safeMessage(503));
        }
        if (!response.ok) {
            let fields: FieldErrors = {};
            if (response.status === 400) {
                const parsed = ERROR_SCHEMA.safeParse(await response.json().catch(() => null));
                const names = new Set(resource.fields.map((field) => field.name));
                fields = Object.fromEntries(
                    [...names]
                        .map((name): [string, string[]] => [
                            name,
                            parsed.success
                                ? (parsed.data.error.issues ?? [])
                                      .filter((issue) => issue.path[0] === name)
                                      .map((issue) => issue.message)
                                : [],
                        ])
                        .filter(([, issues]) => issues.length > 0),
                );
            }
            throw new AdminCrudError(response.status, safeMessage(response.status), fields);
        }

        return response;
    }

    private async record(response: Response): Promise<AdminRecord> {
        const parsed = RECORD_SCHEMA.safeParse(await response.json().catch(() => null));
        if (!parsed.success) {
            throw new AdminCrudError(502, safeMessage(502));
        }

        return parsed.data;
    }

    async list(resource: AdminResourceMetadata, limit = 20, orderBy = ''): Promise<AdminRecord[]> {
        const query = new URLSearchParams({ limit: String(limit), ...(orderBy ? { orderBy } : {}) });
        const response = await this.request(resource, 'GET', undefined, undefined, `?${query}`);
        const parsed = z.object({ rows: z.array(RECORD_SCHEMA) }).safeParse(await response.json().catch(() => null));
        if (!parsed.success) {
            throw new AdminCrudError(502, safeMessage(502));
        }

        return parsed.data.rows;
    }

    async retrieve(resource: AdminResourceMetadata, id: string): Promise<AdminRecord> {
        return this.record(await this.request(resource, 'GET', id));
    }

    async create(resource: AdminResourceMetadata, body: AdminRecord): Promise<AdminRecord> {
        return this.record(await this.request(resource, 'POST', undefined, body));
    }

    async update(resource: AdminResourceMetadata, id: string, body: AdminRecord): Promise<void> {
        await this.request(resource, 'PATCH', id, body);
    }

    async delete(resource: AdminResourceMetadata, id: string): Promise<void> {
        await this.request(resource, 'DELETE', id);
    }
}
