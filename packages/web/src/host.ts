import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { PUBLIC_CONFIG_ELEMENT } from './constants.js';
import { isReservedPath } from './routes.js';

export { PUBLIC_CONFIG_ELEMENT };

const TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.txt': 'text/plain; charset=utf-8',
    '.webmanifest': 'application/manifest+json',
};

/** Serialize public config for an inline JSON script: `<`, `>`, `&` and line separators are escaped. */
export function serializePublicConfig(config: Readonly<Record<string, string>>): string {
    return JSON.stringify(config)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

export function injectPublicConfig(html: string, config: Readonly<Record<string, string>>): string {
    const script = `<script id="${PUBLIC_CONFIG_ELEMENT}" type="application/json">${serializePublicConfig(config)}</script>`;

    return html.includes('</head>') ? html.replace('</head>', `${script}</head>`) : `${script}${html}`;
}

export type WebHostOptions = {
    /** The built consumer output (`.nestrum/web`). */
    readonly directory: string;
    /** The allowlisted client-safe configuration; nothing else is ever serialized. */
    readonly publicEnv?: Readonly<Record<string, string>>;
    /** Normalized base path (`''` for the root, otherwise `/app`). Requests outside it are not handled. */
    readonly basePath?: string;
    /** Render HTML navigations on the server instead of serving the static index. */
    readonly render?: SsrRender;
};

/** What an SSR entry receives. `template` is the built `index.html` with public config already embedded. */
export type SsrContext = {
    readonly template: string;
    readonly basePath: string;
    readonly publicEnv: Readonly<Record<string, string>>;
};

/**
 * The contract of a consumer SSR entry's `render` export. Return a `Response` (normally HTML built from the
 * template), or `undefined` for "not found". Only GET/HEAD navigations outside framework namespaces reach it.
 */
export type SsrRender = (request: Request, context: SsrContext) => Response | undefined | Promise<Response | undefined>;

export type WebHost = { handle(request: Request): Promise<Response | undefined> };

const empty = (status: number, headers: Record<string, string> = {}): Response =>
    new Response(null, { status, headers });

/**
 * Static SPA hosting. Only GET/HEAD are handled; framework namespaces are never served (the runtime consults this
 * only after every framework route missed, and this re-checks). Real files win; an extensionless, HTML-accepting
 * route falls back to the consumer `index.html`. Missing assets stay 404 rather than serving HTML.
 */
export function createWebHost(options: WebHostOptions): WebHost {
    const publicEnv = options.publicEnv ?? {};
    const basePath = options.basePath ?? '';
    let index: string | undefined;

    async function loadIndex(): Promise<string> {
        index ??= injectPublicConfig(await readFile(join(options.directory, 'index.html'), 'utf8'), publicEnv);

        return index;
    }

    async function respond(
        request: Request,
        body: string | Uint8Array,
        headers: Record<string, string>,
    ): Promise<Response> {
        return new Response(request.method === 'HEAD' ? null : (body as BodyInit), { status: 200, headers });
    }

    return {
        async handle(request) {
            if (request.method !== 'GET' && request.method !== 'HEAD') {
                return undefined;
            }
            let pathname: string;
            try {
                pathname = decodeURIComponent(new URL(request.url).pathname);
            } catch {
                return empty(400);
            }
            if (isReservedPath(pathname) || pathname.includes('\0')) {
                return undefined;
            }
            if (basePath !== '') {
                if (pathname === basePath) {
                    return empty(308, { location: `${basePath}/${new URL(request.url).search}` });
                }
                if (!pathname.startsWith(`${basePath}/`)) {
                    return undefined;
                }
                pathname = pathname.slice(basePath.length);
            }
            const relative = normalize(pathname).replace(/^[/\\]+/, '');
            if (relative.split(sep).includes('..')) {
                return undefined;
            }
            const file = join(options.directory, relative);
            const isFile =
                relative !== '' &&
                (await stat(file)
                    .then((s) => s.isFile())
                    .catch(() => false));
            if (isFile && relative !== 'index.html') {
                const hashed = relative.startsWith(`assets${sep}`);

                return respond(request, await readFile(file), {
                    'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
                    'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
                    'x-content-type-options': 'nosniff',
                });
            }
            const accept = request.headers.get('accept');
            const wantsHtml = accept === null || accept.includes('text/html') || accept.includes('*/*');
            if (extname(pathname) !== '' || !wantsHtml) {
                return undefined;
            }

            if (options.render) {
                const rendered = await options.render(request, { template: await loadIndex(), basePath, publicEnv });

                return rendered && request.method === 'HEAD'
                    ? new Response(null, { status: rendered.status, headers: rendered.headers })
                    : rendered;
            }

            return respond(request, await loadIndex(), {
                'content-type': TYPES['.html'] as string,
                'cache-control': 'no-cache',
                'x-content-type-options': 'nosniff',
            });
        },
    };
}
