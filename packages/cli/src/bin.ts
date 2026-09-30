#!/usr/bin/env node
import { AppError } from '@nestrum/core';
import { CLI_HELP, parseCliArguments } from './arguments.js';
import { AUTH_HELP, parseAuthArguments } from './auth-arguments.js';
import { runAuthCommand } from './auth-command.js';
import { runBuild } from './build.js';
import { CliError } from './cli.errors.js';
import { loadCliConfig } from './config.js';
import { runDatabaseCommand } from './database-command.js';
import { runDev } from './dev.js';
import { promptNewPassword } from './prompt.js';
import { parseRuntimeArguments, RUNTIME_COMMANDS, RUNTIME_HELP } from './runtime-arguments.js';
import { runServe } from './serve.js';
import { installShutdownSignals } from './signals.js';

/** First SIGINT/SIGTERM shuts down gracefully; a repeated signal, or a failed shutdown, exits immediately. */
function installGracefulSignals(target: { shutdown(): Promise<void> }): void {
    installShutdownSignals(target, {
        onError: (error) => {
            process.stderr.write(`Shutdown failed: ${error instanceof Error ? error.message : String(error)}\n`);
            process.exit(1);
        },
        onRepeat: () => {
            process.stderr.write('Repeated signal; forcing exit.\n');
            process.exit(1);
        },
    });
}

const args = process.argv.slice(2);
try {
    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
        process.stdout.write(`${RUNTIME_HELP}\n\n${CLI_HELP}\n\n${AUTH_HELP}\n`);
    } else if (RUNTIME_COMMANDS.includes(args[0] ?? '')) {
        const parsed = parseRuntimeArguments(args);
        if (parsed.command === 'build') {
            const { manifest, directory } = await runBuild({
                ...(parsed.config === undefined ? {} : { config: parsed.config }),
            });
            process.stdout.write(
                `Built ${manifest.apps.length} app(s), ${manifest.resources} resource(s), ${manifest.database ? 'a' : 'no'} database contract into ${directory}\n`,
            );
        } else if (parsed.command === 'serve') {
            const server = await runServe({
                ...(parsed.config === undefined ? {} : { config: parsed.config }),
                flags: {
                    ...(parsed.host === undefined ? {} : { host: parsed.host }),
                    ...(parsed.port === undefined ? {} : { port: parsed.port }),
                },
            });
            process.stdout.write(`Nestrum listening on http://${server.host}:${server.port}\n`);
            installGracefulSignals(server);
        } else {
            const session = await runDev({
                ...(parsed.config === undefined ? {} : { config: parsed.config }),
                ...(parsed.features === undefined ? {} : { features: parsed.features }),
                flags: {
                    ...(parsed.host === undefined ? {} : { host: parsed.host }),
                    ...(parsed.port === undefined ? {} : { port: parsed.port }),
                },
            });
            installGracefulSignals({ shutdown: () => session.close() });
        }
    } else if (args[0] === 'auth') {
        const result = await runAuthCommand(parseAuthArguments(args), { promptPassword: promptNewPassword });
        process.stdout.write(
            `${result.created ? 'Created' : 'Promoted'} administrator ${result.email} (role ${result.role}). They must set up two-factor authentication at first sign-in.\n`,
        );
    } else {
        const parsed = parseCliArguments(args);
        const result = await runDatabaseCommand(await loadCliConfig(parsed.config), parsed);
        process.stdout.write(result.stdout);
        process.stderr.write(result.stderr);
    }
} catch (error) {
    process.stderr.write(
        `${
            error instanceof AppError
                ? `${error.code}: ${error.message}`
                : RUNTIME_COMMANDS.includes(args[0] ?? '') || args[0] === 'auth'
                  ? `CLI_FAILED: ${error instanceof Error ? error.message : String(error)}`
                  : 'CLI_FAILED: Nestrum database command failed.'
        }\n`,
    );
    process.exitCode = error instanceof CliError ? error.exitCode : 1;
}
