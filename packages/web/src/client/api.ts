import { ApiError, toApiError } from './errors.js';

export type ApiClientOptions = {
    readonly fetch?: typeof fetch;
    /** Public API prefix on the same origin. Only `/api/...` is reachable; default `/api`. */
    readonly basePath?: string;
    /** Sent as `X-API-Key`. Intended for server-side/test use; browsers normally rely on the session cookie. */
    readonly headers?: Readonly<Record<string, string>>;
};

export type ApiRequest = {
    readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
    readonly body?: unknown;
    readonly signal?: AbortSignal;
};

export type ApiClient = {
    get<T = unknown>(path: string, request?: ApiRequest): Promise<T>;
    post<T = unknown>(path: string, request?: ApiRequest): Promise<T>;
    put<T = unknown>(path: string, request?: ApiRequest): Promise<T>;
    patch<T = unknown>(path: string, request?: ApiRequest): Promise<T>;
    delete<T = unknown>(path: string, request?: ApiRequest): Promise<T>;
};

/**
 * Resolve a resource path against the public API base. Absolute URLs, protocol-relative URLs, traversal, and
 * anything outside the public prefix (notably `/admin` and `/__admin`) are rejected.
 */
export function resolveApiPath(path: string, basePath = '/api'): string {
    if (!/^\/api(\/|$)/.test(basePath) || basePath.includes('..')) {
        throw new ApiError(0, 'API_PATH_INVALID', 'The API base path must be under /api.');
    }
    const relative = path.startsWith('/') ? path : `/${path}`;
    if (relative.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(path) || relative.split(/[/\\]/).includes('..')) {
        throw new ApiError(0, 'API_PATH_INVALID', 'API paths must be same-origin resource paths.');
    }
    const normalized =
        relative.startsWith(`${basePath}/`) || relative === basePath ? relative : `${basePath}${relative}`;
    if (/(^|\/)__admin(\/|$)/.test(normalized)) {
        throw new ApiError(0, 'API_PATH_INVALID', 'The admin API is not available to consumer helpers.');
    }

    return normalized;
}

/** A same-origin public API client: session cookies are included and failures become `ApiError`. */
export function createApiClient(options: ApiClientOptions = {}): ApiClient {
    const call = async <T>(method: string, path: string, request: ApiRequest = {}): Promise<T> => {
        const url = new URL(resolveApiPath(path, options.basePath), 'http://same-origin.invalid');
        for (const [key, value] of Object.entries(request.query ?? {})) {
            if (value !== undefined) {
                url.searchParams.set(key, String(value));
            }
        }
        const response = await (options.fetch ?? fetch)(`${url.pathname}${url.search}`, {
            method,
            credentials: 'same-origin',
            headers: {
                accept: 'application/json',
                ...(request.body === undefined ? {} : { 'content-type': 'application/json' }),
                ...options.headers,
            },
            ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
            ...(request.signal === undefined ? {} : { signal: request.signal }),
        });
        if (!response.ok) {
            throw await toApiError(response);
        }
        if (response.status === 204) {
            return undefined as T;
        }

        return (await response.json()) as T;
    };

    return {
        get: (path, request) => call('GET', path, request),
        post: (path, request) => call('POST', path, request),
        put: (path, request) => call('PUT', path, request),
        patch: (path, request) => call('PATCH', path, request),
        delete: (path, request) => call('DELETE', path, request),
    };
}
