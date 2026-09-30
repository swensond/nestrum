import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ResolvedWebConfig, WebHost } from '@nestrum/web';
import {
    describeCollisions,
    findRouteCollisions,
    injectPublicConfig,
    isReservedPath,
    resolveWebConfig,
} from '@nestrum/web';
import { CliError } from './cli.errors.js';
import type { CliConfig } from './cli.types.js';

export const WEB_OUTPUT = 'web';

export type ConsumerWeb = ResolvedWebConfig & { readonly directory: string };

/** The resolved consumer UI of a config, with its root made absolute against the config directory. */
export function consumerWeb(config: CliConfig, configDir: string): ConsumerWeb | undefined {
    const resolved = resolveWebConfig(config.web);

    return (
        resolved && {
            ...resolved,
            directory: resolve(config.rootDir ? resolve(configDir, config.rootDir) : configDir, resolved.root),
        }
    );
}

type ViteModule = {
    build(config: Record<string, unknown>): Promise<unknown>;
    createServer(config: Record<string, unknown>): Promise<{
        listen(): Promise<unknown>;
        close(): Promise<void>;
        httpServer: { address(): { port: number } | string | null } | null;
    }>;
};

/** Vite belongs to the application (it owns the Svelte plugin and config), so it resolves from the web root. */
async function loadVite(webRoot: string): Promise<ViteModule> {
    try {
        const entry = createRequire(join(webRoot, 'package.json')).resolve('vite');

        return (await import(pathToFileURL(entry).href)) as ViteModule;
    } catch (cause) {
        throw new CliError(
            'BUILD_WEB_FAILED',
            `The consumer UI at ${webRoot} needs "vite" installed in its project. Install it and retry.`,
            1,
            { cause },
        );
    }
}

async function assertWebRoot(web: ConsumerWeb): Promise<void> {
    const found = await stat(join(web.directory, 'index.html')).then(
        (s) => s.isFile(),
        () => false,
    );
    if (!found) {
        throw new CliError('BUILD_WEB_FAILED', `The consumer UI root ${web.directory} has no index.html (Vite entry).`);
    }
    const collisions = await findRouteCollisions(web.directory);
    if (collisions.length > 0) {
        throw new CliError('BUILD_WEB_COLLISION', describeCollisions(collisions));
    }
}

const SECRET_NAME = /SECRET|PASSWORD|TOKEN|PRIVATE|CREDENTIAL/i;
const CREDENTIAL_URL = /^[a-z][a-z0-9+.-]*:\/\/[^/@\s:]+:[^/@\s]+@/i;

/** Server-only values that must never appear in browser output: secret-named variables and credentialed URLs. */
export function serverSecrets(
    env: Record<string, string | undefined>,
    publicEnv: Readonly<Record<string, string>>,
): string[] {
    const allowed = new Set(Object.values(publicEnv));

    return Object.entries(env)
        .filter(
            (entry): entry is [string, string] =>
                typeof entry[1] === 'string' &&
                entry[1].length >= 8 &&
                !allowed.has(entry[1]) &&
                (SECRET_NAME.test(entry[0]) || CREDENTIAL_URL.test(entry[1])),
        )
        .map(([, value]) => value);
}

async function* walk(directory: string): AsyncGenerator<string> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            yield* walk(path);
        } else {
            yield path;
        }
    }
}

/** Fail the build when a server-only value was bundled into the browser output. Returns the scanned file count. */
export async function assertNoSecretsInOutput(directory: string, secrets: readonly string[]): Promise<number> {
    let scanned = 0;
    for await (const file of walk(directory)) {
        scanned += 1;
        if (secrets.length === 0) {
            continue;
        }
        const content = (await readFile(file)).toString('latin1');
        if (secrets.some((secret) => content.includes(secret))) {
            throw new CliError(
                'BUILD_WEB_LEAK',
                `A server-only value was bundled into the consumer UI (${file}). Expose values only through web.publicEnv.`,
            );
        }
    }

    return scanned;
}

/** Build the consumer UI to `<build>/web`: collisions rejected, no source maps, output scanned for secrets. */
export async function buildConsumerWeb(
    web: ConsumerWeb,
    buildDir: string,
    env: Record<string, string | undefined> = process.env,
): Promise<{ readonly directory: string }> {
    await assertWebRoot(web);
    const outDir = join(buildDir, WEB_OUTPUT);
    await rm(outDir, { recursive: true, force: true });
    const vite = await loadVite(web.directory);
    try {
        await vite.build({
            root: web.directory,
            base: '/',
            logLevel: 'warn',
            build: { outDir, emptyOutDir: true, sourcemap: false },
        });
    } catch (cause) {
        throw new CliError('BUILD_WEB_FAILED', `The consumer UI failed to build.\n${(cause as Error).message}`, 1, {
            cause,
        });
    }
    if (
        !(await stat(join(outDir, 'index.html')).then(
            (s) => s.isFile(),
            () => false,
        ))
    ) {
        throw new CliError('BUILD_WEB_FAILED', 'The consumer UI build produced no index.html.');
    }
    await assertNoSecretsInOutput(outDir, serverSecrets(env, web.publicEnv));

    return { directory: WEB_OUTPUT };
}

async function freePort(): Promise<number> {
    return new Promise((resolvePort, reject) => {
        const probe = createServer();
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const { port } = probe.address() as { port: number };
            probe.close(() => resolvePort(port));
        });
    });
}

export type DevWeb = {
    readonly host: WebHost;
    /** Swap the client-safe configuration served with the page (config edits restart the backend, not Vite). */
    setPublicEnv(publicEnv: Readonly<Record<string, string>>): void;
    close(): Promise<void>;
};

/**
 * The internal Vite dev server behind `nestrum dev`. Vite is never the user-facing process: this returns a host
 * that proxies only GET/HEAD requests the backend did not claim. HMR's websocket uses its own internal port, so
 * pure frontend edits never touch the backend.
 */
export async function startDevWeb(web: ConsumerWeb): Promise<DevWeb> {
    await assertWebRoot(web);
    const vite = await loadVite(web.directory);
    const hmrPort = await freePort();
    const server = await vite.createServer({
        root: web.directory,
        base: '/',
        logLevel: 'warn',
        clearScreen: false,
        server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: { port: hmrPort, host: 'localhost' } },
    });
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') {
        await server.close();
        throw new CliError('BUILD_WEB_FAILED', 'The consumer dev server did not bind a port.');
    }
    let publicEnv = web.publicEnv;

    return {
        setPublicEnv: (next) => {
            publicEnv = next;
        },
        host: {
            async handle(request) {
                if (request.method !== 'GET' && request.method !== 'HEAD') {
                    return undefined;
                }
                const url = new URL(request.url);
                if (isReservedPath(url.pathname)) {
                    return undefined;
                }
                const headers = new Headers(request.headers);
                headers.delete('host');
                const upstream = await fetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, {
                    method: request.method,
                    headers,
                    redirect: 'manual',
                }).catch(() => undefined);
                if (!upstream) {
                    return new Response('The consumer dev server is not reachable.', { status: 502 });
                }
                const out = new Headers(upstream.headers);
                out.delete('content-encoding');
                out.delete('content-length');
                if ((upstream.headers.get('content-type') ?? '').includes('text/html')) {
                    return new Response(
                        request.method === 'HEAD' ? null : injectPublicConfig(await upstream.text(), publicEnv),
                        { status: upstream.status, headers: out },
                    );
                }

                return new Response(request.method === 'HEAD' ? null : upstream.body, {
                    status: upstream.status,
                    headers: out,
                });
            },
        },
        close: () => server.close(),
    };
}
