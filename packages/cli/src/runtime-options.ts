import { CliError } from './cli.errors.js';
import type { ServerConfig } from './cli.types.js';

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 3000;

export type ServerOptions = { readonly host: string; readonly port: number };
export type Environment = Readonly<Record<string, string | undefined>>;

function parsePort(value: string, source: string): number {
    if (!/^\d{1,5}$/.test(value.trim()) || Number(value) > 65535) {
        throw new CliError('CLI_SERVER_OPTIONS_INVALID', `${source} must be an integer between 0 and 65535.`);
    }

    return Number(value);
}

/** Resolve each option as: CLI flag → environment variable → `nestrum.config.ts` → Nestrum default. */
export function resolveServerOptions(input: {
    readonly flags?: ServerConfig;
    readonly env?: Environment;
    readonly config?: ServerConfig | undefined;
}): ServerOptions {
    const env = input.env ?? process.env;
    const host = input.flags?.host ?? (env.HOST?.trim() || undefined) ?? input.config?.host ?? DEFAULT_HOST;
    const port =
        input.flags?.port ??
        (env.PORT?.trim() ? parsePort(env.PORT, 'PORT') : undefined) ??
        input.config?.port ??
        DEFAULT_PORT;
    if (!host.trim()) {
        throw new CliError('CLI_SERVER_OPTIONS_INVALID', 'Host must not be empty.');
    }

    return { host, port };
}

export type NestrumEnvironment = 'development' | 'production';

/**
 * `dev` establishes development and `serve` establishes production. An explicit conflicting `NESTRUM_ENV` is
 * rejected, so an environment override can never turn `serve` into a development process. The result is written
 * back for application code that reads `NESTRUM_ENV`.
 */
export function establishEnvironment(
    mode: NestrumEnvironment,
    env: Record<string, string | undefined> = process.env,
): NestrumEnvironment {
    const requested = env.NESTRUM_ENV?.trim();
    if (requested && requested !== mode) {
        throw new CliError(
            'CLI_ENVIRONMENT_CONFLICT',
            `NESTRUM_ENV=${requested} conflicts with \`nestrum ${mode === 'production' ? 'serve' : 'dev'}\`, which runs in ${mode}. Unset NESTRUM_ENV or set it to "${mode}".`,
        );
    }
    env.NESTRUM_ENV = mode;

    return mode;
}
