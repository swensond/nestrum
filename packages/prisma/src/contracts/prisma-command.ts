import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { AppError } from '@nestrum/core';
import type { GeneratedPrismaContract } from './contracts.types.js';

const EXEC_FILE = promisify(execFile);
export class PrismaCommandError extends AppError {
    constructor(
        public readonly exitCode: number,
        options: ErrorOptions,
    ) {
        super('PRISMA_COMMAND_FAILED', 'Delegated Prisma command failed.', 500, options);
        this.name = 'PrismaCommandError';
    }
}

export async function writePrismaWorkflowConfig(
    contract: GeneratedPrismaContract,
    migrationsDir: string,
): Promise<string> {
    const provider = contract.provider === 'postgresql' ? '@prisma/orm-postgres/config' : '@prisma/orm-mongo/config';
    const imports =
        `import { ormOptions } from ${JSON.stringify(pathToFileURL(contract.configPath).href)};\n` +
        `import { definePrismaConfig } from ${JSON.stringify(import.meta.resolve('prisma/config'))};\n` +
        `import { defineConfig } from ${JSON.stringify(import.meta.resolve(provider))};\n`;
    const path = join(contract.configPath, '..', 'workflow.config.mjs');
    await writeFile(
        path,
        `${imports}export default definePrismaConfig({ orm: defineConfig({ ...ormOptions, migrations: { dir: ${JSON.stringify(migrationsDir)} }, db: { connection: process.env.NESTRUM_DATABASE_CONNECTION } }) });\n`,
        { encoding: 'utf8', mode: 0o600 },
    );

    return path;
}

export async function runPrismaCommand(
    args: readonly string[],
    options: { cwd: string; connection?: string; timeoutMs?: number },
): Promise<{ stdout: string; stderr: string }> {
    const cli = fileURLToPath(new URL('./dist/prisma.js', import.meta.resolve('prisma/package.json')));
    try {
        const result = await EXEC_FILE(process.execPath, [cli, ...args], {
            cwd: options.cwd,
            env: {
                ...process.env,
                DO_NOT_TRACK: '1',
                PRISMA_DISABLE_TELEMETRY: '1',
                ...(options.connection === undefined ? {} : { NESTRUM_DATABASE_CONNECTION: options.connection }),
            },
            timeout: options.timeoutMs ?? 30_000,
            maxBuffer: 1024 * 1024,
        });

        return { stdout: result.stdout, stderr: result.stderr };
    } catch (cause) {
        const failure = cause as { code?: unknown };
        throw new PrismaCommandError(
            typeof failure.code === 'number' && failure.code > 0 && failure.code < 256 ? failure.code : 1,
            { cause },
        );
    }
}
