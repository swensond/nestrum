import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { assemblePrismaContract } from './contracts.assembly.js';
import { PrismaContractError } from './contracts.errors.js';
import type { ContractApplication, GeneratePrismaOptions, PrismaGeneration } from './contracts.types.js';

const EXEC_FILE = promisify(execFile);
const DEFAULT_EMIT_TIMEOUT_MS = 30_000;
const MAX_EMIT_OUTPUT_BYTES = 1024 * 1024;

export async function generatePrismaContract(
    application: ContractApplication,
    options: GeneratePrismaOptions,
): Promise<PrismaGeneration> {
    const contract = await assemblePrismaContract(application, options);

    if (contract === undefined) {
        throw new PrismaContractError('PRISMA_FRAGMENTS_EMPTY', 'No installed app contributes Prisma fragments.');
    }

    if (options.authoring !== undefined && !['native', 'prisma7'].includes(options.authoring)) {
        throw new PrismaContractError('PRISMA_EMIT_FAILED', 'Invalid authoring mode; use "native" or "prisma7".');
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
        {
            const databaseDir = directory;
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
            const providerConfig = '@prisma/orm-postgres/config';
            const legacy = options.authoring === 'prisma7';
            const contractExpression = legacy
                ? `prisma7Schema(${JSON.stringify(sourcePath)})`
                : JSON.stringify(sourcePath);
            const controlModules = (options.extensions ?? []).filter(
                (extension) => extension.controlModule !== undefined,
            );
            const extensionImports = controlModules
                .map(
                    (extension, index) =>
                        `import extension${index} from ${JSON.stringify(pathToFileURL(resolve(options.rootDir, extension.controlModule ?? '')).href)};\n`,
                )
                .join('');
            const extensionConfig = controlModules.length
                ? `, extensions: [${controlModules.map((_, index) => `extension${index}`).join(', ')}]`
                : '';
            const config =
                `import { definePrismaConfig } from ${JSON.stringify(import.meta.resolve('prisma/config'))};\n` +
                `import { defineConfig${legacy ? ', prisma7Schema' : ''} } from ${JSON.stringify(import.meta.resolve(providerConfig))};\n` +
                extensionImports +
                `export const ormOptions = { contract: ${contractExpression}${extensionConfig} };\n` +
                'export default definePrismaConfig({ orm: defineConfig(ormOptions) });\n';
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
                    `Prisma emission failed.\n${output.stderr ?? ''}\n${output.stdout ?? ''}\nSources:\n${sources}`,
                    { cause },
                );
            }

            const contractPath = join(databaseDir, 'contract.json');
            const typesPath = join(databaseDir, 'contract.d.ts');
            await readFile(contractPath, 'utf8');
            await readFile(typesPath, 'utf8');
            return Object.freeze({
                directory,
                contract: Object.freeze({ ...contract, configPath, sourcePath, contractPath, typesPath }),
            });
        }
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
