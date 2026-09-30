import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Application } from '@nestrum/core';
import { CliError } from './cli.errors.js';
import type { CliConfig } from './cli.types.js';

export function defineCliConfig(config: CliConfig): CliConfig {
    if (
        !config ||
        !(config.application instanceof Application) ||
        config.application.state !== 'created' ||
        [config.rootDir, config.outputDir, config.migrationsDir].some(
            (value) => value !== undefined && (typeof value !== 'string' || !value.trim()),
        ) ||
        (config.timeoutMs !== undefined && (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0))
    ) {
        throw new CliError(
            'CLI_CONFIG_INVALID',
            'CLI config requires an unstarted application and valid paths/timeout.',
        );
    }

    return Object.freeze({ ...config });
}

export async function loadCliConfig(path: string, cwd = process.cwd()): Promise<CliConfig> {
    const absolute = resolve(cwd, path);
    let loaded: { default?: CliConfig };
    try {
        loaded = (await import(pathToFileURL(absolute).href)) as { default?: CliConfig };
    } catch (cause) {
        throw new CliError('CLI_CONFIG_LOAD_FAILED', `Unable to load Nestrum configuration at ${absolute}.`, 1, {
            cause,
        });
    }
    const config = defineCliConfig(loaded.default as CliConfig);

    return defineCliConfig({ ...config, rootDir: resolve(dirname(absolute), config.rootDir ?? '.') });
}
