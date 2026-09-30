import { resolve } from 'node:path';
import {
    generatePrismaContract,
    PrismaCommandError,
    runPrismaCommand,
    writePrismaWorkflowConfig,
} from '@nestrum/prisma/node';
import { CliError } from './cli.errors.js';
import type { CliArguments, CliConfig } from './cli.types.js';
import { defineCliConfig } from './config.js';

export type DatabaseCommandDependencies = {
    readonly generate: typeof generatePrismaContract;
    readonly execute: typeof runPrismaCommand;
    readonly configure: typeof writePrismaWorkflowConfig;
};
const DEPENDENCIES: DatabaseCommandDependencies = {
    generate: generatePrismaContract,
    execute: runPrismaCommand,
    configure: writePrismaWorkflowConfig,
};

export async function runDatabaseCommand(
    config: CliConfig,
    args: CliArguments,
    dependencies = DEPENDENCIES,
): Promise<{ stdout: string; stderr: string }> {
    config = defineCliConfig(config);
    const database = config.application.database;
    const rootDir = resolve(config.rootDir ?? process.cwd());
    const generation = await dependencies.generate(config.application, {
        rootDir,
        outputDir: config.contractDir ?? config.outputDir ?? '.nestrum/contracts',
        ...(config.authoring === undefined ? {} : { authoring: config.authoring }),
        ...(config.extensions === undefined ? {} : { extensions: config.extensions }),
        ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
    });
    const contract = generation.contract;
    if (args.command === 'generate') {
        return {
            stdout: args.json
                ? `${JSON.stringify({ directory: generation.directory, contract: contract.contractPath, types: contract.typesPath })}\n`
                : `Generated ${contract.contractPath}\n`,
            stderr: '',
        };
    }
    const migrationsDir = resolve(rootDir, config.migrationsDir ?? 'prisma/migrations');
    const configPath = await dependencies.configure(contract, migrationsDir);
    const command =
        args.command === 'status' ? ['migration', 'status'] : args.plan ? ['migration', 'plan'] : ['db', 'migrate'];
    const delegated = [
        ...command,
        '--config',
        configPath,
        '--no-interactive',
        '--no-color',
        ...(args.json ? ['--json'] : []),
        ...(args.name ? ['--name', args.name] : []),
        ...(args.confirm ?? []).flatMap((token) => ['--confirm', token]),
    ];
    try {
        const result = await dependencies.execute(delegated, {
            cwd: rootDir,
            ...(args.plan ? {} : { connection: database.connection }),
            ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
        });

        return {
            stdout: result.stdout.replaceAll(database.connection, '[redacted]'),
            stderr: result.stderr.replaceAll(database.connection, '[redacted]'),
        };
    } catch (cause) {
        if (cause instanceof PrismaCommandError) {
            const details = cause.cause as { stderr?: string; stdout?: string };
            const output = [details?.stderr, details?.stdout]
                .filter((value) => typeof value === 'string')
                .join('\n')
                .replaceAll(database.connection, '[redacted]');
            throw new CliError(
                'CLI_DELEGATE_FAILED',
                `Prisma ${command.join(' ')} failed.\n${output}`,
                cause.exitCode,
                { cause },
            );
        }
        throw cause;
    }
}
