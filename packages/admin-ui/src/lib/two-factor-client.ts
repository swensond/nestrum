import { z } from 'zod';

const ENABLE_SCHEMA = z.object({
    totpURI: z.string().startsWith('otpauth://'),
    backupCodes: z.array(z.string().min(1)),
});

export type TwoFactorResult<Value> =
    | { readonly ok: true; readonly value: Value }
    | { readonly ok: false; readonly message: string };
export type TwoFactorFetch = typeof globalThis.fetch;

/** Fixed, safe messages: the Better Auth response body is never echoed to the page. */
function failureMessage(status: number, code: unknown): string {
    if (status === 429 || code === 'ACCOUNT_TEMPORARILY_LOCKED') {
        return 'Too many attempts. Wait a few minutes and try again.';
    }
    if (code === 'INVALID_TWO_FACTOR_COOKIE') {
        return 'Your sign-in expired. Sign in again to continue.';
    }
    if (code === 'INVALID_PASSWORD') {
        return 'That password is not correct.';
    }
    if (status === 400 || status === 401) {
        return 'That code is not valid. Check the code and try again.';
    }

    return 'Unable to complete the request. Please try again.';
}

/** Browser client for Better Auth's two-factor endpoints; the session cookies travel with same-origin requests. */
export class TwoFactorClient {
    constructor(private readonly fetch: TwoFactorFetch = globalThis.fetch) {}

    private async post(path: string, body: object): Promise<TwoFactorResult<unknown>> {
        let response: Response;
        try {
            response = await this.fetch(`/api/auth/two-factor/${path}`, {
                method: 'POST',
                credentials: 'same-origin',
                cache: 'no-store',
                headers: { accept: 'application/json', 'content-type': 'application/json' },
                body: JSON.stringify(body),
            });
        } catch {
            return { ok: false, message: failureMessage(503, undefined) };
        }
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) {
            const code = payload && typeof payload === 'object' ? (payload as { code?: unknown }).code : undefined;

            return { ok: false, message: failureMessage(response.status, code) };
        }

        return { ok: true, value: payload };
    }

    /** Starts (or restarts) enrollment. The factor is inactive until {@link verifyTotp} succeeds. */
    async enable(
        password: string,
    ): Promise<TwoFactorResult<{ totpURI: string; secret: string; backupCodes: string[] }>> {
        const result = await this.post('enable', { password });
        if (!result.ok) {
            return result;
        }
        const parsed = ENABLE_SCHEMA.safeParse(result.value);
        const secret = parsed.success ? new URL(parsed.data.totpURI).searchParams.get('secret') : null;
        if (!parsed.success || !secret) {
            return { ok: false, message: failureMessage(502, undefined) };
        }

        return { ok: true, value: { totpURI: parsed.data.totpURI, secret, backupCodes: parsed.data.backupCodes } };
    }

    async verifyTotp(code: string): Promise<TwoFactorResult<void>> {
        const result = await this.post('verify-totp', { code: code.replace(/\s+/g, '') });

        return result.ok ? { ok: true, value: undefined } : result;
    }

    async verifyBackupCode(code: string): Promise<TwoFactorResult<void>> {
        const result = await this.post('verify-backup-code', { code: code.trim() });

        return result.ok ? { ok: true, value: undefined } : result;
    }

    async signOut(): Promise<boolean> {
        try {
            return (
                await this.fetch('/api/auth/sign-out', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'content-type': 'application/json' },
                    body: '{}',
                })
            ).ok;
        } catch {
            return false;
        }
    }
}
