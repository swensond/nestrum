import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { AdminFetch } from './metadata.js';
import { safeReturnTo } from './return-to.js';

const ENROLLMENT_SCHEMA = z.object({ secret: z.string().min(1), otpauthUri: z.string().startsWith('otpauth://') });
const CONFIRMATION_SCHEMA = z.object({ recoveryCodes: z.array(z.string().min(1)).min(1) });
const ERROR_SCHEMA = z.object({ error: z.object({ code: z.string() }) });

const MESSAGES: Readonly<Record<string, string>> = {
    TWO_FACTOR_INVALID_CODE: 'That code is not valid. Check the code and try again.',
    TWO_FACTOR_LOCKED: 'Too many attempts. Wait a few minutes and try again.',
    TWO_FACTOR_ALREADY_CONFIGURED: 'Two-factor authentication is already set up for this account.',
    TWO_FACTOR_NOT_CONFIGURED: 'Two-factor authentication is not set up for this account.',
    TWO_FACTOR_ENROLLMENT_NOT_STARTED: 'Start setup again to get a new key.',
};

export class TwoFactorError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = 'TwoFactorError';
    }
}

function safeMessage(status: number, code: string | undefined): string {
    if (code !== undefined && MESSAGES[code] !== undefined) {
        return MESSAGES[code];
    }
    if (status === 401) {
        return 'Your session has expired. Sign in again.';
    }
    if (status === 403) {
        return 'You do not have permission to perform this operation.';
    }

    return 'Unable to complete the request. Please try again.';
}

/** Server-side client for the private `/__admin/auth/2fa/*` API. Never caches, never logs bodies. */
export class TwoFactorClient {
    constructor(private readonly fetch: AdminFetch) {}

    private async post(path: string, body: object): Promise<unknown> {
        let response: Response;
        try {
            response = await this.fetch(`/__admin/auth/2fa/${path}`, {
                method: 'POST',
                credentials: 'same-origin',
                cache: 'no-store',
                headers: { accept: 'application/json', 'content-type': 'application/json' },
                body: JSON.stringify(body),
            });
        } catch {
            throw new TwoFactorError(503, safeMessage(503, undefined));
        }
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) {
            const parsed = ERROR_SCHEMA.safeParse(payload);
            throw new TwoFactorError(response.status, safeMessage(response.status, parsed.data?.error.code));
        }

        return payload;
    }

    async start(): Promise<{ secret: string; otpauthUri: string }> {
        const parsed = ENROLLMENT_SCHEMA.safeParse(await this.post('enroll/start', {}));
        if (!parsed.success) {
            throw new TwoFactorError(502, safeMessage(502, undefined));
        }

        return parsed.data;
    }

    async confirm(code: string): Promise<readonly string[]> {
        const parsed = CONFIRMATION_SCHEMA.safeParse(await this.post('enroll/confirm', { code }));
        if (!parsed.success) {
            throw new TwoFactorError(502, safeMessage(502, undefined));
        }

        return parsed.data.recoveryCodes;
    }

    async challenge(code: string): Promise<void> {
        await this.post('challenge', { code });
    }

    async recover(code: string): Promise<void> {
        await this.post('recovery/verify', { code });
    }
}

type FormEvent = { fetch: AdminFetch; request: Request };

/** Reads exactly one bounded `code` and an optional `next`; anything else is rejected. */
async function readCode(request: Request, allowed: readonly string[]) {
    const data = await request.formData();
    const code = data.get('code');
    const next = safeReturnTo(data.get('next'));
    if (
        typeof code !== 'string' ||
        !code.trim() ||
        code.length > 64 ||
        data.getAll('code').length !== 1 ||
        [...data.keys()].some((name) => !allowed.includes(name))
    ) {
        return { next, error: fail(400, { message: 'Enter the code to continue.', next }) } as const;
    }

    return { next, code: code.trim() } as const;
}

function failure(error: unknown, next: string) {
    const known = error instanceof TwoFactorError ? error : new TwoFactorError(503, safeMessage(503, undefined));

    return fail(known.status, { message: known.message, next });
}

/** Completes a challenge with a TOTP or a recovery code, then returns to the intended admin URL. */
export async function submitChallenge(event: FormEvent, method: 'totp' | 'recovery') {
    const read = await readCode(event.request, ['code', 'next']);
    if ('error' in read) {
        return read.error;
    }
    try {
        const client = new TwoFactorClient(event.fetch);
        await (method === 'totp' ? client.challenge(read.code) : client.recover(read.code));
    } catch (error) {
        return failure(error, read.next);
    }

    redirect(303, read.next);
}

export async function startEnrollment(event: FormEvent) {
    const next = safeReturnTo((await event.request.formData()).get('next'));
    try {
        return { step: 'confirm' as const, next, ...(await new TwoFactorClient(event.fetch).start()) };
    } catch (error) {
        return failure(error, next);
    }
}

export async function confirmEnrollment(event: FormEvent) {
    const read = await readCode(event.request, ['code', 'next']);
    if ('error' in read) {
        return read.error;
    }
    try {
        return {
            step: 'done' as const,
            next: read.next,
            recoveryCodes: await new TwoFactorClient(event.fetch).confirm(read.code),
        };
    } catch (error) {
        const known = error instanceof TwoFactorError ? error : new TwoFactorError(503, safeMessage(503, undefined));

        // The pending key is never re-sent; a failed attempt keeps the code form and offers a fresh start.
        return fail(known.status, { message: known.message, next: read.next, step: 'retry' as const });
    }
}
