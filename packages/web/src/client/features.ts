import { toApiError } from './errors.js';

/** The framework-owned endpoint serving evaluated, client-safe flag values for the current session. */
export const FEATURES_PATH = '/__nestrum/features';

export type FeatureState =
    | { readonly status: 'loading'; readonly values: Readonly<Record<string, boolean>> }
    | { readonly status: 'ready'; readonly values: Readonly<Record<string, boolean>> }
    | { readonly status: 'error'; readonly values: Readonly<Record<string, boolean>> };

export type FeatureClientOptions = { readonly fetch?: typeof fetch };

export type FeatureClient = {
    /** Fetch the current values from the server and update `state`. Failures leave every flag off. */
    load(): Promise<Readonly<Record<string, boolean>>>;
    /** Synchronous read of the last loaded snapshot; unknown, hidden or not-yet-loaded flags are `false`. */
    enabled(name: string): boolean;
    /** Svelte-store-compatible state: `subscribe` calls back immediately and on every change. */
    readonly state: { subscribe(run: (state: FeatureState) => void): () => void };
};

/**
 * Feature flags for the consumer UI. The server evaluates every flag for the current session and sends only booleans
 * of flags declared `exposeToClient: true`; the browser never sees targeting rules or other flag names. Values are
 * informational: hiding UI is a convenience, and the API/resource ABAC decision stays on the server. Snapshots can be
 * stale until `load()` runs again.
 */
export function createFeatureClient(options: FeatureClientOptions = {}): FeatureClient {
    let current: FeatureState = { status: 'loading', values: Object.freeze({}) };
    const listeners = new Set<(state: FeatureState) => void>();
    const publish = (next: FeatureState): void => {
        current = next;
        for (const listener of listeners) {
            listener(current);
        }
    };

    return {
        async load() {
            try {
                const response = await (options.fetch ?? fetch)(FEATURES_PATH, {
                    credentials: 'same-origin',
                    cache: 'no-store',
                    headers: { accept: 'application/json' },
                });
                if (!response.ok) {
                    throw await toApiError(response);
                }
                const body = (await response.json()) as { features?: Record<string, unknown> };
                const values = Object.freeze(
                    Object.fromEntries(
                        Object.entries(body.features ?? {}).filter(
                            (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
                        ),
                    ),
                );
                publish({ status: 'ready', values });

                return values;
            } catch {
                publish({ status: 'error', values: Object.freeze({}) });

                return current.values;
            }
        },
        enabled: (name) => Object.hasOwn(current.values, name) && current.values[name] === true,
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
