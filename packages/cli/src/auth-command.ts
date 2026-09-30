import { dirname, join, resolve } from 'node:path';
import type { Application } from '@nestrum/core';
import type { AuthArguments } from './auth-arguments.js';
import { CliError } from './cli.errors.js';
import { loadCliConfig } from './config.js';
import { cliVersion, readManifest } from './manifest.js';
import { establishEnvironment } from './runtime-options.js';

export type AuthCommandOptions = {
    readonly cwd?: string;
    readonly env?: Record<string, string | undefined>;
    /** Asks for the password on a terminal; only used when NESTRUM_ADMIN_PASSWORD is unset. */
    readonly promptPassword?: () => Promise<string>;
};

export type AdministratorResult = { readonly email: string; readonly role: string; readonly created: boolean };

/** The command's core, independent of how the application was loaded. */
export async function createAdministratorFor(
    application: Application,
    arguments_: Pick<AuthArguments, 'email' | 'name' | 'promote'>,
    password: string | undefined,
): Promise<AdministratorResult> {
    const auth = application.auth;
    if (!auth) {
        throw new CliError('CLI_AUTH_NOT_CONFIGURED', 'This application does not configure Better Auth.');
    }
    const email = arguments_.email.trim();
    const { user, created } = await auth.createAdministrator({
        email,
        name: arguments_.name?.trim() || email.split('@')[0] || email,
        // An existing account keeps its own password when promoted.
        password: password ?? '',
        promoteExisting: arguments_.promote,
    });

    return { email: user.email, role: user.role, created };
}

/**
 * Create (or promote) an administrator against a previous build. The application is started like `serve` starts it —
 * databases connect and Better Auth initializes — but no HTTP listener binds, and the process shuts down afterward.
 */
export async function runAuthCommand(
    parsed: AuthArguments,
    options: AuthCommandOptions = {},
): Promise<AdministratorResult> {
    const env = options.env ?? process.env;
    const cwd = resolve(options.cwd ?? process.cwd());
    const root = parsed.config === undefined ? cwd : dirname(resolve(cwd, parsed.config));
    establishEnvironment('production', env);
    const manifest = await readManifest(root, await cliVersion());
    const config = await loadCliConfig(join(root, '.nestrum', manifest.entry.path), root, root);
    if (!config.application.authConfigured) {
        throw new CliError('CLI_AUTH_NOT_CONFIGURED', 'This application does not configure Better Auth.');
    }
    let password = env.NESTRUM_ADMIN_PASSWORD;
    if (password === undefined && !parsed.promote) {
        if (!options.promptPassword) {
            throw new CliError(
                'CLI_ARGUMENT_INVALID',
                'Set NESTRUM_ADMIN_PASSWORD, or run in a terminal to be prompted for the password.',
            );
        }
        password = await options.promptPassword();
    }
    await config.application.start();
    try {
        return await createAdministratorFor(config.application, parsed, password);
    } finally {
        await config.application.shutdown();
    }
}
