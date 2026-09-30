/** Application-owned consumer UI configuration, set as `web` in `nestrum.config.ts`. */
export type WebConfig = {
    readonly enabled?: boolean;
    /** Directory of the application's Vite project (relative to the config), default `./src/web`. */
    readonly root?: string;
    /**
     * The only values that reach the browser. Everything is explicitly selected here; nothing is inferred from the
     * server environment. Values must be strings.
     */
    readonly publicEnv?: Readonly<Record<string, string>>;
};

export type ResolvedWebConfig = {
    readonly root: string;
    readonly publicEnv: Readonly<Record<string, string>>;
};

export const DEFAULT_WEB_ROOT = './src/web';
const PUBLIC_ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class WebConfigError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = 'WebConfigError';
        this.code = code;
    }
}

/** Validate `web`; returns `undefined` when the consumer UI is not enabled. */
export function resolveWebConfig(config: WebConfig | undefined): ResolvedWebConfig | undefined {
    if (config === undefined || config.enabled !== true) {
        return undefined;
    }
    if (typeof config !== 'object' || Array.isArray(config)) {
        throw new WebConfigError('WEB_CONFIG_INVALID', 'web must be an object.');
    }
    const root = config.root ?? DEFAULT_WEB_ROOT;
    if (typeof root !== 'string' || !root.trim()) {
        throw new WebConfigError('WEB_CONFIG_INVALID', 'web.root must be a non-empty path.');
    }
    const publicEnv = config.publicEnv ?? {};
    if (typeof publicEnv !== 'object' || publicEnv === null || Array.isArray(publicEnv)) {
        throw new WebConfigError('WEB_CONFIG_INVALID', 'web.publicEnv must be a record of strings.');
    }
    for (const [key, value] of Object.entries(publicEnv)) {
        if (!PUBLIC_ENV_KEY.test(key) || typeof value !== 'string') {
            throw new WebConfigError(
                'WEB_CONFIG_INVALID',
                `web.publicEnv.${key} must have an identifier name and a string value (undefined environment values are rejected).`,
            );
        }
    }

    return { root, publicEnv: Object.freeze({ ...publicEnv }) };
}
