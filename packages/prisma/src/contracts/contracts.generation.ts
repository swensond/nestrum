import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { assemblePrismaContracts } from './contracts.assembly.js';
import { PrismaContractError } from './contracts.errors.js';
import type {
    ContractApplication,
    GeneratedPrismaContract,
    GeneratePrismaOptions,
    PrismaGeneration,
} from './contracts.types.js';

const EXEC_FILE = promisify(execFile);
const DEFAULT_EMIT_TIMEOUT_MS = 30_000;
const MAX_EMIT_OUTPUT_BYTES = 1024 * 1024;

export async function generatePrismaContracts(
    application: ContractApplication,
    options: GeneratePrismaOptions,
): Promise<PrismaGeneration> {
    const contracts = await assemblePrismaContracts(application, options);

    if (contracts.length === 0) {
        throw new PrismaContractError('PRISMA_FRAGMENTS_EMPTY', 'No installed app contributes Prisma fragments.');
    }

    for (const [database, authoring] of Object.entries(options.authoring ?? {})) {
        if (
            !application.databases.has(database) ||
            !['native', 'prisma7'].includes(authoring) ||
            (authoring === 'prisma7' && application.databases.get(database).provider !== 'postgresql')
        ) {
            throw new PrismaContractError(
                'PRISMA_EMIT_FAILED',
                `Invalid authoring mode for database "${database}". prisma7 authoring requires PostgreSQL.`,
            );
        }
    }

    const timeout = options.timeoutMs ?? DEFAULT_EMIT_TIMEOUT_MS;

    if (!Number.isFinite(timeout) || timeout <= 0) {
        throw new PrismaContractError(
            'PRISMA_EMIT_FAILED',
            'Prisma emission timeout must be a positive finite number.',
        );
    }

    try {
        const outputDir = resolve(options.rootDir, options.outputDir);
        await mkdir(outputDir, { recursive: true });
        const directory = await mkdtemp(join(outputDir, 'run-'));
        const generated: GeneratedPrismaContract[] = [];

        for (const contract of contracts) {
            const databaseDir = join(directory, contract.database);
            const fragmentDir = join(databaseDir, 'fragments');
            await mkdir(fragmentDir, { recursive: true });

            for (const [index, fragment] of contract.fragments.entries()) {
                const provenance = JSON.stringify({ app: fragment.app, path: fragment.path });
                const content = `// use prisma-8\n// Nestrum source: ${provenance}\n${fragment.content.replace(/^\uFEFF/, '')}\n`;
                await writeFile(join(fragmentDir, `${String(index).padStart(6, '0')}.prisma`), content, 'utf8');
            }

            const configPath = join(databaseDir, 'prisma.config.mjs');
            const sourcePath = join(databaseDir, 'contract.prisma');
            await writeFile(sourcePath, contract.source, 'utf8');
            const providerConfig =
                contract.provider === 'postgresql' ? '@prisma/orm-postgres/config' : '@prisma/orm-mongo/config';
            const legacy = options.authoring?.[contract.database] === 'prisma7';
            const contractExpression = legacy
                ? `prisma7Schema(${JSON.stringify(sourcePath)})`
                : JSON.stringify(sourcePath);
            const config =
                `import { definePrismaConfig } from ${JSON.stringify(import.meta.resolve('prisma/config'))};\n` +
                `import { defineConfig${legacy ? ', prisma7Schema' : ''} } from ${JSON.stringify(import.meta.resolve(providerConfig))};\n` +
                `export default definePrismaConfig({ orm: defineConfig({ contract: ${contractExpression} }) });\n`;
            await writeFile(configPath, config, 'utf8');
            const cli = fileURLToPath(new URL('./dist/prisma.js', import.meta.resolve('prisma/package.json')));

            try {
                await EXEC_FILE(
                    process.execPath,
                    [cli, 'contract', 'emit', '--config', configPath, '--output-path', databaseDir, '--json'],
                    {
                        cwd: databaseDir,
                        env: { ...process.env, DO_NOT_TRACK: '1', PRISMA_DISABLE_TELEMETRY: '1' },
                        timeout,
                        maxBuffer: MAX_EMIT_OUTPUT_BYTES,
                    },
                );
            } catch (cause) {
                const output = cause as { stderr?: string; stdout?: string };
                const sources = contract.fragments.map((fragment) => `${fragment.app}: ${fragment.path}`).join('\n');
                throw new PrismaContractError(
                    'PRISMA_EMIT_FAILED',
                    `Prisma emission failed for database "${contract.database}".\n${output.stderr ?? ''}\n${output.stdout ?? ''}\nSources:\n${sources}`,
                    { cause },
                );
            }

            const contractPath = join(databaseDir, 'contract.json');
            const typesPath = join(databaseDir, 'contract.d.ts');
            await readFile(contractPath, 'utf8');
            await readFile(typesPath, 'utf8');
            generated.push(Object.freeze({ ...contract, configPath, sourcePath, contractPath, typesPath }));
        }

        return Object.freeze({ directory, contracts: Object.freeze(generated) });
    } catch (cause) {
        if (cause instanceof PrismaContractError) {
            throw cause;
        }

        throw new PrismaContractError(
            'PRISMA_OUTPUT_FAILED',
            'Unable to stage or read generated Prisma contract artifacts.',
            { cause },
        );
    }
}
