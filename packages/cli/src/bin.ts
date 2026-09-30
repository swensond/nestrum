#!/usr/bin/env node
import { AppError } from '@nestrum/core';
import { CLI_HELP, parseCliArguments } from './arguments.js';
import { CliError } from './cli.errors.js';
import { loadCliConfig } from './config.js';
import { runDatabaseCommand } from './database-command.js';

const args = process.argv.slice(2);
try {
    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
        process.stdout.write(`${CLI_HELP}\n`);
    } else {
        const parsed = parseCliArguments(args);
        const result = await runDatabaseCommand(await loadCliConfig(parsed.config), parsed);
        process.stdout.write(result.stdout);
        process.stderr.write(result.stderr);
    }
} catch (error) {
    process.stderr.write(
        `${error instanceof AppError ? `${error.code}: ${error.message}` : 'CLI_FAILED: Nestrum database command failed.'}\n`,
    );
    process.exitCode = error instanceof CliError ? error.exitCode : 1;
}
