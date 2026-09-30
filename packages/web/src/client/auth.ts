import { ApiError, toApiError } from './errors.js';

export type SessionUser = {
    readonly id: string;
    readonly email: string;
    readonly name?: string;
    readonly role?: string;
};
export type AuthSession = {
    readonly user: SessionUser;
    readonly session: { readonly id: string; readonly expiresAt?: string };
};
export type AuthState =
    | { readonly status: 'loading'; readonly user: undefined; readonly error: undefined }
    | { readonly status: 'authenticated'; readonly user: SessionUser; readonly error: undefined }
    | { readonly status: 'anonymous'; readonly user: undefined; readonly error: ApiError | undefined };

export type AuthClientOptions = { readonly fetch?: typeof fetch; readonly basePath?: string };

export type AuthClient = {
    getSession(): Promise<AuthSession | null>;
    getUser(): Promise<SessionUser | null>;
    signIn(credentials: { email: string; password: string }): Promise<AuthSession>;
    signOut(): Promise<void>;
    /** Svelte-store-compatible state: `subscribe` calls back immediately and on every change. */
    readonly state: {
        subscribe(run: (state: AuthState) => void): () => void;
    };
    /** Re-read the session from the server and update `state`. */
    refresh(): Promise<AuthState>;
};

/**
 * Consumer auth over Better Auth's same-origin endpoints (`/api/auth/*`). Only session and email sign-in/out are
 * exposed; there is no admin, API-key management, or two-factor administration surface here.
 */
export function createAuthClient(options: AuthClientOptions = {}): AuthClient {
    const basePath = options.basePath ?? '/api/auth';
    const request = async (path: string, init: RequestInit = {}): Promise<Response> => {
        const response = await (options.fetch ?? fetch)(`${basePath}${path}`, {
            credentials: 'same-origin',
            ...init,
            headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) },
        });
        if (!response.ok) {
            throw await toApiError(response);
        }

        return response;
    };
    let current: AuthState = { status: 'loading', user: undefined, error: undefined };
    const listeners = new Set<(state: AuthState) => void>();
    const publish = (next: AuthState): AuthState => {
        current = next;
        for (const listener of listeners) {
            listener(current);
        }

        return current;
    };
    const readSession = async (): Promise<AuthSession | null> => {
        const response = await request('/get-session');
        const text = await response.text();
        const body = text ? (JSON.parse(text) as Partial<AuthSession> | null) : null;

        return body?.user && body.session ? (body as AuthSession) : null;
    };
    const anonymous = (error?: ApiError): AuthState => ({ status: 'anonymous', user: undefined, error });
    const authenticated = (user: SessionUser): AuthState => ({ status: 'authenticated', user, error: undefined });

    return {
        getSession: readSession,
        getUser: async () => (await readSession())?.user ?? null,
        async signIn(credentials) {
            try {
                await request('/sign-in/email', { method: 'POST', body: JSON.stringify(credentials) });
            } catch (error) {
                publish(anonymous(error instanceof ApiError ? error : undefined));
                throw error;
            }
            const session = await readSession();
            if (!session) {
                const error = new ApiError(401, 'UNAUTHENTICATED', 'Sign-in did not establish a session.');
                publish(anonymous(error));
                throw error;
            }
            publish(authenticated(session.user));

            return session;
        },
        async signOut() {
            await request('/sign-out', { method: 'POST', body: '{}' });
            publish(anonymous());
        },
        async refresh() {
            try {
                const session = await readSession();

                return publish(session ? authenticated(session.user) : anonymous());
            } catch (error) {
                return publish(anonymous(error instanceof ApiError ? error : undefined));
            }
        },
        state: {
            subscribe(run) {
                listeners.add(run);
                run(current);

                return () => {
                    listeners.delete(run);
                };
            },
        },
    };
}
