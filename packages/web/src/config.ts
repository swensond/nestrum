import { isReservedPath } from './routes.js';

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
    /**
     * URL prefix the consumer UI is served under, e.g. `/app`. Default `/` (the site root). It may not start with a
     * framework namespace (`/api`, `/admin`, `/__admin`, `/__nestrum`). Requests outside it are not the UI's.
     */
    readonly basePath?: string;
    /**
     * Server-side rendering. `entry` is a module in the web root exporting `render(request, context)` (see
     * `SsrRender`). Nestrum builds it as a Vite SSR bundle, loads it in production, and loads it through Vite in
     * development. Omit for a static SPA.
     */
    readonly ssr?: { readonly entry: string };
};

export type ResolvedWebConfig = {
    readonly root: string;
    readonly publicEnv: Readonly<Record<string, string>>;
    /** `''` for the site root, otherwise `/segment[/segment]` with no trailing slash. */
    readonly basePath: string;
    readonly ssr: { readonly entry: string } | undefined;
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

    const basePath = normalizeBasePath(config.basePath);
    if (config.ssr !== undefined && (typeof config.ssr?.entry !== 'string' || !config.ssr.entry.trim())) {
        throw new WebConfigError('WEB_CONFIG_INVALID', 'web.ssr.entry must be a non-empty module path.');
    }

    return {
        root,
        publicEnv: Object.freeze({ ...publicEnv }),
        basePath,
        ssr: config.ssr === undefined ? undefined : { entry: config.ssr.entry },
    };
}

const BASE_SEGMENT = /^[A-Za-z0-9._~-]+$/;

/** `undefined`, `''` and `/` mean the root; otherwise a validated `/a/b` without a trailing slash. */
export function normalizeBasePath(basePath: string | undefined): string {
    if (basePath === undefined || basePath === '' || basePath === '/') {
        return '';
    }
    const segments = typeof basePath === 'string' && basePath.startsWith('/') ? basePath.slice(1).split('/') : [];
    if (segments.at(-1) === '') {
        segments.pop();
    }
    if (segments.length === 0 || segments.some((segment) => !BASE_SEGMENT.test(segment) || /^\.+$/.test(segment))) {
        throw new WebConfigError(
            'WEB_CONFIG_INVALID',
            'web.basePath must be "/" or an absolute path of plain segments such as "/app".',
        );
    }
    if (isReservedPath(`/${segments[0]}`)) {
        throw new WebConfigError(
            'WEB_CONFIG_INVALID',
            `web.basePath "/${segments.join('/')}" starts with a reserved framework namespace.`,
        );
    }

    return `/${segments.join('/')}`;
}
