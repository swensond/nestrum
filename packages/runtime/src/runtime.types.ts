/**
 * The ready application an adapter serves. It is runtime-neutral: only a web-standard Fetch handler is required.
 * `HonoRuntime` from `@nestrum/hono` satisfies this shape structurally.
 *
 * The caller starts the application and completes readiness before calling `RuntimeAdapter.serve`; adapters never
 * start, configure, or shut down the application.
 */
export interface ServableApplication {
    readonly fetch: (request: Request) => Response | Promise<Response>;
}

export interface ServeOptions {
    readonly host: string;
    /** TCP port to bind. `0` requests an ephemeral port; the bound port is reported on the `ServerHandle`. */
    readonly port: number;
}

/**
 * A running server. Both operations are idempotent and may be called concurrently.
 */
export interface ServerHandle {
    /** The host the server is bound to. */
    readonly host: string;
    /** The port the server is bound to, resolved when `ServeOptions.port` was `0`. */
    readonly port: number;
    /**
     * Stop accepting new connections and requests without waiting for in-flight work. It matches the
     * `stopTraffic` hook of `@nestrum/hono`, so the caller can gate traffic before draining and application shutdown.
     */
    stopAccepting(): Promise<void>;
    /** Stop accepting traffic (if not already) and release the listener. Resolves once the server is fully closed. */
    close(): Promise<void>;
}

/**
 * Hosts a ready application on a concrete runtime.
 *
 * - `serve` resolves only once the server is accepting traffic.
 * - If startup fails, `serve` rejects and leaves no listener or other resource behind.
 * - Adapters do not discover applications, generate artifacts, or own the application lifecycle; closing a handle does
 *   not shut down the application.
 */
export interface RuntimeAdapter {
    serve(application: ServableApplication, options: ServeOptions): Promise<ServerHandle>;
}
