import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Application } from '@nestrum/core';
import { CliError } from './cli.errors.js';
import type { CliConfig } from './cli.types.js';

function validServer(server: unknown): boolean {
    if (!server || typeof server !== 'object' || Array.isArray(server)) {
        return false;
    }
    const { host, port, drainTimeoutMs } = server as { host?: unknown; port?: unknown; drainTimeoutMs?: unknown };

    return (
        (host === undefined || (typeof host === 'string' && host.trim() !== '')) &&
        (port === undefined || (Number.isInteger(port) && (port as number) >= 0 && (port as number) <= 65535)) &&
        (drainTimeoutMs === undefined ||
            (typeof drainTimeoutMs === 'number' && Number.isFinite(drainTimeoutMs) && drainTimeoutMs > 0))
    );
}

export function defineCliConfig(config: CliConfig): CliConfig {
    if (
        !config ||
        !(config.application instanceof Application) ||
        config.application.state !== 'created' ||
        [config.rootDir, config.outputDir, config.migrationsDir].some(
            (value) => value !== undefined && (typeof value !== 'string' || !value.trim()),
        ) ||
        (config.timeoutMs !== undefined && (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0)) ||
        (config.server !== undefined && !validServer(config.server)) ||
        (config.contractDirs !== undefined &&
            (typeof config.contractDirs !== 'object' ||
                Array.isArray(config.contractDirs) ||
                Object.values(config.contractDirs).some((value) => typeof value !== 'string' || !value.trim())))
    ) {
        throw new CliError(
            'CLI_CONFIG_INVALID',
            'CLI config requires an unstarted application and valid paths/timeout.',
        );
    }

    return Object.freeze({ ...config });
}

/**
 * The application configuration entry (`nestrum.config.ts`). It extends the database CLI configuration with
 * `server` host/port defaults; `defineCliConfig` remains an alias so existing database commands are unchanged.
 */
export const defineConfig = defineCliConfig;

export const CONFIG_CANDIDATES = ['nestrum.config.ts', 'nestrum.config.mts', 'nestrum.config.mjs', 'nestrum.config.js'];

/** Resolve an explicit config path or the single conventional `nestrum.config.*` file in `cwd`. */
export function discoverConfig(cwd: string, explicit?: string): string {
    if (explicit !== undefined) {
        const path = resolve(cwd, explicit);
        if (!existsSync(path)) {
            throw new CliError('CLI_CONFIG_NOT_FOUND', `Nestrum configuration not found at ${path}.`);
        }

        return path;
    }
    const found = CONFIG_CANDIDATES.map((name) => resolve(cwd, name)).filter((path) => existsSync(path));
    if (found.length !== 1) {
        throw new CliError(
            'CLI_CONFIG_NOT_FOUND',
            found.length === 0
                ? `No nestrum.config.ts found in ${cwd}.`
                : `Multiple Nestrum configuration files found in ${cwd}; pass --config.`,
        );
    }

    return found[0] as string;
}

export async function loadCliConfig(
    path: string,
    cwd = process.cwd(),
    configDir?: string,
    bustCache = false,
): Promise<CliConfig> {
    const absolute = resolve(cwd, path);
    let loaded: { default?: CliConfig };
    try {
        loaded = (await import(
            `${pathToFileURL(absolute).href}${bustCache ? `?v=${Date.now()}-${Math.random()}` : ''}`
        )) as { default?: CliConfig };
    } catch (cause) {
        throw new CliError('CLI_CONFIG_LOAD_FAILED', `Unable to load Nestrum configuration at ${absolute}.`, 1, {
            cause,
        });
    }
    const config = defineCliConfig(loaded.default as CliConfig);

    return defineCliConfig({ ...config, rootDir: resolve(configDir ?? dirname(absolute), config.rootDir ?? '.') });
}
