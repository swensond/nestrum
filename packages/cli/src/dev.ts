import { watch as fsWatch } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import type { ModelMetadata } from '@nestrum/core';
import { AppError } from '@nestrum/core';
import type { HonoRuntime } from '@nestrum/hono';
import { createHonoRuntime } from '@nestrum/hono';
import { assemblePrismaContracts } from '@nestrum/prisma/node';
import type { RuntimeAdapter, ServerHandle } from '@nestrum/runtime';
import { nodeRuntime } from '@nestrum/runtime-node';
import { ADMIN_UI_PACKAGE, bundleConfig, generateArtifacts, loadBuiltConfig, validateResources } from './build.js';
import type { ServerConfig } from './cli.types.js';
import { CONFIG_CANDIDATES, discoverConfig } from './config.js';
import { withHealth } from './health.js';
import { cliVersion, sha256 } from './manifest.js';
import type { Environment } from './runtime-options.js';
import { establishEnvironment, resolveServerOptions } from './runtime-options.js';
import { loadAdminShell } from './serve.js';

export type ChangeKind = 'config' | 'prisma' | 'app' | 'frontend';

const IGNORED_SEGMENTS = new Set(['node_modules', '.nestrum', '.git', 'dist', '.svelte-kit', 'coverage']);
const APP_EXTENSIONS = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json']);
const DRAIN_TIMEOUT_MS = 5000;

/** Classify a changed file, or `undefined` when it cannot affect the application (including generated output). */
export function classifyChange(root: string, file: string): ChangeKind | undefined {
    const parts = relative(root, file).split(sep);
    if (parts[0] === '..' || parts.some((part) => IGNORED_SEGMENTS.has(part) || part.startsWith('.tmp-'))) {
        return undefined;
    }
    const name = basename(file);
    const extension = extname(file);
    if (parts.length === 1 && CONFIG_CANDIDATES.includes(name)) {
        return 'config';
    }
    if (extension === '.prisma') {
        return 'prisma';
    }
    if (extension === '.svelte') {
        return 'frontend';
    }

    return APP_EXTENSIONS.has(extension) ? 'app' : undefined;
}

export type DevOptions = {
    readonly cwd?: string;
    readonly config?: string;
    readonly flags?: ServerConfig;
    readonly env?: Record<string, string | undefined>;
    readonly adapter?: RuntimeAdapter;
    readonly log?: (line: string) => void;
    /** Quiet period that coalesces bursts of edits into one restart. */
    readonly debounceMs?: number;
    /** Set false to skip filesystem watching (tests drive `changed`). */
    readonly watch?: boolean;
};

export type DevSession = {
    /** Base URL of the running server, or `undefined` while stopped after a failed cycle. */
    url(): string | undefined;
    /** Report a filesystem change; classified, debounced, and coalesced into restarts. */
    changed(file: string): void;
    /** Resolves when no restart is pending or running. */
    idle(): Promise<void>;
    close(): Promise<void>;
};

type Running = { readonly runtime: HonoRuntime; readonly handle: ServerHandle; readonly url: string };

function describe(error: unknown): string {
    if (error instanceof AppError) {
        return `${error.name}: ${error.code}: ${error.message}`;
    }

    return error instanceof Error ? `Error: ${error.message}` : `Error: ${String(error)}`;
}

/**
 * `nestrum dev`: run the same application definition as production from freshly compiled sources, and restart it
 * completely on change. Prisma contracts, metadata, and resource validation are regenerated only when the assembled
 * schema actually changed. Databases are never migrated; a changed schema only produces migration guidance.
 */
export async function runDev(options: DevOptions = {}): Promise<DevSession> {
    const env = options.env ?? process.env;
    const log = options.log ?? ((line: string) => void process.stdout.write(`${line}\n`));
    const cwd = resolve(options.cwd ?? process.cwd());
    establishEnvironment('development', env);
    const configPath = discoverConfig(cwd, options.config);
    const root = dirname(configPath);
    const devDir = join(root, '.nestrum', 'dev');
    await rm(devDir, { recursive: true, force: true });
    await mkdir(devDir, { recursive: true });
    const version = await cliVersion();
    const adapter = options.adapter ?? nodeRuntime;
    const debounceMs = options.debounceMs ?? 100;

    let generation = 0;
    let running: Running | undefined;
    let models: readonly ModelMetadata[] | undefined;
    const schemas = new Map<string, string>();
    let pending = new Set<ChangeKind>();
    let timer: NodeJS.Timeout | undefined;
    let loop: Promise<void> | undefined;
    let closed = false;

    async function stop(): Promise<void> {
        const current = running;
        running = undefined;
        if (!current) {
            return;
        }
        try {
            await current.runtime.shutdown();
        } finally {
            await current.handle.close();
        }
    }

    async function cycle(kinds: ReadonlySet<ChangeKind>): Promise<void> {
        try {
            await stop();
        } catch (error) {
            log(describe(error));
        }
        if (kinds.has('config')) {
            models = undefined;
        }
        const entry = join(devDir, `server-${++generation}.mjs`);
        try {
            await bundleConfig(configPath, entry);
            const config = await loadBuiltConfig(entry, root);
            const rootDir = resolve(config.rootDir ?? root);
            const assembled = await assemblePrismaContracts(config.application, {
                rootDir,
                ...(config.extensions === undefined ? {} : { extensions: config.extensions }),
            });
            const next = new Map(assembled.map((contract) => [contract.database, sha256(contract.source)]));
            const changed = [...next].filter(([name, hash]) => schemas.get(name) !== hash).map(([name]) => name);
            if (models === undefined || changed.length > 0) {
                models = (await generateArtifacts(config, devDir)).models;
                const migrate = changed.filter((name) => schemas.has(name));
                for (const name of migrate) {
                    log(
                        `Schema changed.\n\nDatabase "${name}" may require migration.\n\nRun:\n  nestrum db migrate --database ${name}\n`,
                    );
                }
                schemas.clear();
                for (const [name, hash] of next) {
                    schemas.set(name, hash);
                }
            }
            // Validation initializes a resource registry, so it runs on a separate instance from the one served.
            validateResources((await loadBuiltConfig(entry, root)).application, models);
            const server = resolveServerOptions({
                ...(options.flags === undefined ? {} : { flags: options.flags }),
                env: env as Environment,
                config: config.server,
            });
            const adminUi = await loadAdminShell({
                admin: config.application.adminConfigured ? { package: ADMIN_UI_PACKAGE } : null,
            });
            let handle: ServerHandle | undefined;
            const runtime = createHonoRuntime({
                application: config.application,
                ...(adminUi === undefined ? {} : { adminUi }),
                drainTimeoutMs: DRAIN_TIMEOUT_MS,
                stopTraffic: async () => {
                    await handle?.stopAccepting();
                },
            });
            await runtime.start();
            try {
                handle = await adapter.serve(
                    withHealth(runtime, () => runtime.state === 'ready'),
                    server,
                );
            } catch (error) {
                await runtime.shutdown().catch(() => undefined);
                throw error;
            }
            const shown = ['0.0.0.0', '::'].includes(handle.host) ? 'localhost' : handle.host;
            const url = `http://${shown}:${handle.port}`;
            running = { runtime, handle, url };
            log(
                [
                    `Nestrum ${version} (development)`,
                    '',
                    'Application',
                    `  Apps       ${config.application.apps.all().length}`,
                    `  Resources  ${config.application.resources.all().length}`,
                    `  Databases  ${config.application.databases.names().length}`,
                    '',
                    'HTTP',
                    `  API        ${url}/api`,
                    ...(config.application.adminConfigured ? [`  Admin      ${url}/admin`] : []),
                    `  OpenAPI    ${url}/api/openapi.json`,
                    '',
                    'Watching for changes...',
                ].join('\n'),
            );
        } catch (error) {
            log(`${describe(error)}\n\nFix the error and save to retry.`);
        } finally {
            for (const file of await readdir(devDir).catch(() => [] as string[])) {
                if (file.startsWith('server-') && file !== basename(entry)) {
                    await rm(join(devDir, file), { force: true });
                }
            }
        }
    }

    async function drain(): Promise<void> {
        while (pending.size > 0 && !closed) {
            const kinds = pending;
            pending = new Set();
            log(`Change detected (${[...kinds].join(', ')}); restarting...`);
            await cycle(kinds);
        }
    }

    function schedule(): void {
        clearTimeout(timer);
        timer = setTimeout(() => {
            timer = undefined;
            loop ??= drain().finally(() => {
                loop = undefined;
                if (pending.size > 0 && !closed) {
                    schedule();
                }
            });
        }, debounceMs);
    }

    function changed(file: string): void {
        const kind = classifyChange(root, resolve(root, file));
        if (kind === undefined || closed) {
            return;
        }
        if (kind === 'frontend') {
            log('Svelte component changed; the prebuilt admin shell is not rebuilt by `nestrum dev`.');

            return;
        }
        pending.add(kind);
        schedule();
    }

    await cycle(new Set(['config']));
    const watcher =
        options.watch === false
            ? undefined
            : fsWatch(root, { recursive: true }, (_event, filename) => {
                  if (filename) {
                      changed(join(root, filename.toString()));
                  }
              });

    return {
        url: () => running?.url,
        changed,
        idle: async () => {
            while (timer !== undefined || loop !== undefined) {
                await new Promise((resolve) => setTimeout(resolve, 10));
                await loop;
            }
        },
        close: async () => {
            closed = true;
            watcher?.close();
            clearTimeout(timer);
            timer = undefined;
            await loop;
            await stop();
        },
    };
}
