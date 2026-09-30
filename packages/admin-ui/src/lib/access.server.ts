import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { PAGE_SIZE } from './access-shared.js';
import type { AdminFetch } from './metadata.js';

const USER_SCHEMA = z.object({
    id: z.string().min(1),
    name: z.string(),
    email: z.string(),
    role: z.enum(['user', 'staff', 'admin']),
    twoFactorEnabled: z.boolean(),
    createdAt: z.string(),
});
const PAGE_SCHEMA = z.object({
    users: z.array(USER_SCHEMA),
    total: z.number().int().min(0),
    limit: z.number().int().min(1),
    offset: z.number().int().min(0),
});
const CAPABILITIES_SCHEMA = z.object({ users: z.boolean() });
const ERROR_SCHEMA = z.object({ error: z.object({ code: z.string() }) });

export type AccessUser = z.infer<typeof USER_SCHEMA>;
export type AccessPage = z.infer<typeof PAGE_SCHEMA>;

export class AccessError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = 'AccessError';
    }
}

/** Fixed, safe messages; response bodies are never echoed to the page. */
function safeMessage(status: number, code: string | undefined): string {
    if (code === 'AUTH_ADMIN_ROLE_PROTECTED') {
        return 'Administrators are managed with the command line, not here.';
    }
    if (status === 401) {
        return 'Your session has expired. Sign in again.';
    }
    if (status === 403) {
        return 'You do not have permission to manage users.';
    }
    if (status === 404) {
        return 'That user no longer exists.';
    }
    if (status === 400) {
        return 'That request is not valid.';
    }

    return 'Unable to complete the request. Please try again.';
}

export class AccessClient {
    constructor(private readonly fetch: AdminFetch) {}

    private async request(path: string, init: RequestInit = {}): Promise<unknown> {
        let response: Response;
        try {
            response = await this.fetch(`/__admin/access/${path}`, {
                credentials: 'same-origin',
                cache: 'no-store',
                ...init,
                headers: {
                    accept: 'application/json',
                    ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
                },
            });
        } catch {
            throw new AccessError(503, safeMessage(503, undefined));
        }
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) {
            throw new AccessError(
                response.status,
                safeMessage(response.status, ERROR_SCHEMA.safeParse(payload).data?.error.code),
            );
        }

        return payload;
    }

    /** Whether the current subject may manage users; any failure means no. */
    async canManage(): Promise<boolean> {
        try {
            return CAPABILITIES_SCHEMA.parse(await this.request('capabilities')).users;
        } catch {
            return false;
        }
    }

    async list(options: { offset: number; email?: string }): Promise<AccessPage> {
        const query = new URLSearchParams({
            limit: String(PAGE_SIZE),
            offset: String(options.offset),
            ...(options.email ? { email: options.email } : {}),
        });
        const parsed = PAGE_SCHEMA.safeParse(await this.request(`users?${query}`));
        if (!parsed.success) {
            throw new AccessError(502, safeMessage(502, undefined));
        }

        return parsed.data;
    }

    async setRole(userId: string, role: 'user' | 'staff'): Promise<void> {
        await this.request(`users/${encodeURIComponent(userId)}/role`, {
            method: 'POST',
            body: JSON.stringify({ role }),
        });
    }
}

export async function loadAccessData(fetch: AdminFetch, url: URL) {
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const email = url.searchParams.get('email')?.trim() ?? '';
    if (!Number.isInteger(offset) || offset < 0 || offset > 10_000 || email.length > 254) {
        return { page: null, message: 'That request is not valid.', email: '', offset: 0, saved: '' };
    }
    try {
        const page = await new AccessClient(fetch).list({ offset, ...(email ? { email } : {}) });

        return { page, message: '', email, offset, saved: url.searchParams.get('saved') ?? '' };
    } catch (error) {
        const message = error instanceof AccessError ? error.message : safeMessage(503, undefined);

        return { page: null, message, email, offset, saved: '' };
    }
}

/** Native-form action: exactly one `userId`, one `role` of user or staff, and the list position to return to. */
export async function changeRole(event: { fetch: AdminFetch; request: Request }) {
    const data = await event.request.formData();
    const userId = data.get('userId');
    const role = data.get('role');
    const back = data.get('back');
    if (
        typeof userId !== 'string' ||
        !userId ||
        userId.length > 128 ||
        (role !== 'user' && role !== 'staff') ||
        data.getAll('userId').length !== 1 ||
        data.getAll('role').length !== 1 ||
        [...data.keys()].some((name) => !['userId', 'role', 'back'].includes(name))
    ) {
        return fail(400, { message: 'That request is not valid.' });
    }
    try {
        await new AccessClient(event.fetch).setRole(userId, role);
    } catch (error) {
        const known = error instanceof AccessError ? error : new AccessError(503, safeMessage(503, undefined));

        return fail(known.status, { message: known.message });
    }
    const target = typeof back === 'string' && /^\?[A-Za-z0-9_=&%.@+-]{0,300}$/.test(back) ? back : '?';
    const params = new URLSearchParams(target);
    params.set('saved', role);

    redirect(303, `/admin/access?${params}`);
}
