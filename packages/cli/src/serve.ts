import { dirname, join, resolve } from 'node:path';
import type { HonoRuntime } from '@nestrum/hono';
import { createHonoRuntime } from '@nestrum/hono';
import type { RuntimeAdapter, ServerHandle } from '@nestrum/runtime';
import { nodeRuntime } from '@nestrum/runtime-node';
import { CliError } from './cli.errors.js';
import type { ServerConfig } from './cli.types.js';
import { loadCliConfig } from './config.js';
import { withHealth } from './health.js';
import type { BuildManifest } from './manifest.js';
import { cliVersion, readManifest } from './manifest.js';
import type { Environment, ServerOptions } from './runtime-options.js';
import { DEFAULT_DRAIN_TIMEOUT_MS, establishEnvironment, resolveServerOptions } from './runtime-options.js';

export type ServeCommandOptions = {
    readonly cwd?: string;
    /** Only used to locate the project root; the source configuration is not required in production. */
    readonly config?: string;
    readonly flags?: ServerConfig;
    readonly env?: Record<string, string | undefined>;
    readonly adapter?: RuntimeAdapter;
};

export type RunningServer = {
    readonly host: string;
    readonly port: number;
    readonly manifest: BuildManifest;
    readonly runtime: HonoRuntime;
    /** Ordered shutdown: stop traffic, drain, app shutdown, DI disposal, database disconnect, close the listener. */
    shutdown(): Promise<void>;
};

type AdminModule = { createAdminShell(): Promise<NonNullable<Parameters<typeof createHonoRuntime>[0]['adminUi']>> };

export async function loadAdminShell(
    manifest: Pick<BuildManifest, 'admin'>,
): Promise<AdminModule['createAdminShell'] extends () => Promise<infer Shell> ? Shell | undefined : never> {
    if (!manifest.admin) {
        return undefined;
    }
    const specifier = `${manifest.admin.package}/node`;
    let module: AdminModule;
    try {
        module = (await import(specifier)) as AdminModule;
    } catch (cause) {
        throw new CliError(
            'BUILD_INCOMPLETE',
            `The admin shell package ${manifest.admin.package} is not installed. Install it and retry.`,
            1,
            { cause },
        );
    }

    return module.createAdminShell();
}

/**
 * Serve a previous build. Never compiles, watches, generates, or migrates: the manifest and compiled entry must
 * already exist. The listener binds only after the application and HTTP runtime are ready.
 */
export async function runServe(options: ServeCommandOptions = {}): Promise<RunningServer> {
    const env = options.env ?? process.env;
    const cwd = resolve(options.cwd ?? process.cwd());
    const root = options.config === undefined ? cwd : dirname(resolve(cwd, options.config));
    establishEnvironment('production', env);
    const manifest = await readManifest(root, await cliVersion());
    const config = await loadCliConfig(join(root, '.nestrum', manifest.entry.path), root, root);
    const server: ServerOptions = resolveServerOptions({
        ...(options.flags === undefined ? {} : { flags: options.flags }),
        env: env as Environment,
        config: config.server,
    });
    const adminUi = await loadAdminShell(manifest);
    let handle: ServerHandle | undefined;
    let shuttingDown = false;
    const runtime = createHonoRuntime({
        application: config.application,
        ...(adminUi === undefined ? {} : { adminUi }),
        drainTimeoutMs: config.server?.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS,
        stopTraffic: async () => {
            await handle?.stopAccepting();
        },
    });
    await runtime.start();
    try {
        handle = await (options.adapter ?? nodeRuntime).serve(
            withHealth(runtime, () => !shuttingDown && runtime.state === 'ready'),
            server,
        );
    } catch (error) {
        await runtime.shutdown().catch(() => undefined);
        throw error;
    }
    const listening = handle;
    let stopping: Promise<void> | undefined;

    return {
        host: listening.host,
        port: listening.port,
        manifest,
        runtime,
        shutdown: () => {
            shuttingDown = true;
            stopping ??= (async () => {
                // If draining fails (deadline), resources stay open by design and the listener is not awaited.
                await runtime.shutdown();
                await listening.close();
            })();

            return stopping;
        },
    };
}
