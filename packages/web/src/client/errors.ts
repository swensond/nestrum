/** A failed request. Carries the Nestrum error code/message only; response bodies are never exposed wholesale. */
export class ApiError extends Error {
    readonly status: number;
    readonly code: string;

    constructor(status: number, code: string, message: string) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
    }
}

/** Extract `{ error: { code, message } }` (Nestrum) or `{ code, message }` (Better Auth) from a failed response. */
export async function toApiError(response: Response): Promise<ApiError> {
    let code = response.status === 401 ? 'UNAUTHENTICATED' : 'REQUEST_FAILED';
    let message = response.statusText || 'Request failed.';
    try {
        const body = (await response.json()) as {
            error?: { code?: unknown; message?: unknown };
            code?: unknown;
            message?: unknown;
        };
        const source = body.error ?? body;
        if (typeof source.code === 'string') {
            code = source.code;
        }
        if (typeof source.message === 'string') {
            message = source.message;
        }
    } catch {
        // Non-JSON bodies (proxies, HTML error pages) are not surfaced.
    }

    return new ApiError(response.status, code, message);
}
