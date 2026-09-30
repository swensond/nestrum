import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import type { Application, ModelMetadata } from '@nestrum/core';
import { compileModelMetadata } from '@nestrum/prisma';
import { generatePrismaContracts } from '@nestrum/prisma/node';
import { generateModelSchemas } from '@nestrum/zod';
import { build as esbuild } from 'esbuild';
import { CliError } from './cli.errors.js';
import type { CliConfig } from './cli.types.js';
import { discoverConfig, loadCliConfig } from './config.js';
import type { BuildManifest } from './manifest.js';
import { buildDirectory, cliVersion, MANIFEST_FILE, MANIFEST_VERSION, sha256 } from './manifest.js';
import { buildConsumerWeb, consumerWeb } from './web.js';

export const ADMIN_UI_PACKAGE = '@nestrum/admin-ui';
export const RUNTIME_ADAPTER = '@nestrum/runtime-node';
export const SERVER_ENTRY = 'server/index.mjs';

/**
 * Bundle the application's own sources into one ESM module. Packages stay external so the output resolves
 * dependencies from the project's `node_modules`, and no compiler is needed to load it later.
 */
export async function bundleConfig(configPath: string, outfile: string): Promise<void> {
    try {
        await esbuild({
            entryPoints: [configPath],
            outfile,
            bundle: true,
            packages: 'external',
            platform: 'node',
            format: 'esm',
            target: 'node22',
            sourcemap: false,
            logLevel: 'silent',
        });
    } catch (cause) {
        const messages = (cause as { errors?: { text: string; location?: { file: string; line: number } | null }[] })
            .errors;
        const detail = messages?.length
            ? messages
                  .map((message) =>
                      message.location
                          ? `${message.location.file}:${message.location.line} ${message.text}`
                          : message.text,
                  )
                  .join('\n')
            : String(cause);
        throw new CliError('BUILD_BUNDLE_FAILED', `Unable to compile the application.\n${detail}`, 1, { cause });
    }
}

export type BuildResult = { readonly directory: string; readonly manifest: BuildManifest };

export type BuildOptions = {
    readonly cwd?: string;
    readonly config?: string;
};

/**
 * Validate the application and write `.nestrum/`. The manifest is removed first and written last, so a failed
 * build never leaves a usable manifest. No database is contacted and nothing is migrated.
 */
export async function runBuild(options: BuildOptions = {}): Promise<BuildResult> {
    const cwd = resolve(options.cwd ?? process.cwd());
    const configPath = discoverConfig(cwd, options.config);
    const configDir = dirname(configPath);
    const directory = buildDirectory(configDir);
    await rm(join(directory, MANIFEST_FILE), { force: true });
    for (const stale of ['server', 'generated', 'contracts', 'web']) {
        await rm(join(directory, stale), { recursive: true, force: true });
    }
    const entry = join(directory, SERVER_ENTRY);
    await bundleConfig(configPath, entry);
    const config = await loadBuiltConfig(entry, configDir);
    const manifest = await validateAndGenerate(config, directory, entry);
    const web = consumerWeb(config, configDir);
    const built = web ? await buildConsumerWeb(web, directory) : null;
    const complete = { ...manifest, web: built };
    await writeFile(join(directory, MANIFEST_FILE), `${JSON.stringify(complete, null, 2)}\n`, 'utf8');

    return { directory, manifest: complete };
}

export async function loadBuiltConfig(entry: string, configDir: string): Promise<CliConfig> {
    try {
        return await loadCliConfig(entry, configDir, configDir, true);
    } catch (cause) {
        const reason = cause instanceof Error && cause.cause instanceof Error ? cause.cause : cause;
        throw new CliError(
            'BUILD_VALIDATION_FAILED',
            `Application configuration is invalid: ${reason instanceof Error ? reason.message : String(reason)}`,
            1,
            { cause },
        );
    }
}

export type GeneratedArtifacts = {
    readonly databases: BuildManifest['databases'];
    readonly models: readonly ModelMetadata[];
};

/** Emit per-database contracts and compiled model metadata beneath `directory`. No database is contacted. */
export async function generateArtifacts(config: CliConfig, directory: string): Promise<GeneratedArtifacts> {
    const application = config.application;
    const rootDir = resolve(config.rootDir ?? '.');
    const contractsDir = join(directory, 'contracts');
    const generatedDir = join(directory, 'generated', 'models');
    await rm(contractsDir, { recursive: true, force: true });
    await mkdir(generatedDir, { recursive: true });
    await mkdir(contractsDir, { recursive: true });
    const databases: BuildManifest['databases'][number][] = [];
    const models: ModelMetadata[] = [];
    for (const name of application.databases.names()) {
        const custom = config.contractDirs?.[name];
        if (custom !== undefined) {
            // Drop earlier emission runs so repeated builds do not accumulate inside provider packages.
            const previous = resolve(rootDir, custom);
            for (const entry of await readdir(previous).catch(() => [] as string[])) {
                if (entry.startsWith('run-')) {
                    await rm(join(previous, entry), { recursive: true, force: true });
                }
            }
        }
        const generated = await generatePrismaContracts(application, {
            rootDir,
            outputDir: custom ?? contractsDir,
            database: name,
            ...(config.authoring === undefined ? {} : { authoring: config.authoring }),
            ...(config.extensions === undefined ? {} : { extensions: config.extensions }),
            ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
        });
        const contract = generated.contracts.find((candidate) => candidate.database === name);
        if (!contract) {
            continue;
        }
        // A stable per-database path lets application code locate the emitted contract from a bundle in
        // `<build>/server/` (build) or `<build>/dev/server/` (dev) via `new URL('../contracts/<db>.json', import.meta.url)`.
        const stableContract = join(contractsDir, `${name}.json`);
        await copyFile(contract.contractPath, stableContract);
        const contractJson = JSON.parse(await readFile(contract.contractPath, 'utf8')) as unknown;
        const compiled = compileModelMetadata({
            database: name,
            provider: contract.provider,
            contract: contractJson as never,
        });
        models.push(...compiled);
        const metadataPath = join(generatedDir, `${name}.json`);
        await writeFile(metadataPath, `${JSON.stringify(compiled, null, 2)}\n`, 'utf8');
        databases.push({
            name,
            provider: contract.provider,
            contract: relative(directory, stableContract),
            metadata: relative(directory, metadataPath),
        });
    }

    return { databases, models };
}

/**
 * Check resource-to-model references and schema composition against compiled metadata. This initializes the
 * application's resource registry, so it must run on an application instance that will not be started.
 */
export function validateResources(application: Application, models: readonly ModelMetadata[]): void {
    try {
        application.resources.initialize(models.map((metadata) => generateModelSchemas(metadata)));
    } catch (cause) {
        throw new CliError('BUILD_VALIDATION_FAILED', `Resource validation failed: ${(cause as Error).message}`, 1, {
            cause,
        });
    }
}

async function validateAndGenerate(
    config: CliConfig,
    directory: string,
    entry: string,
): Promise<Omit<BuildManifest, 'web'>> {
    const application = config.application;
    const { databases, models } = await generateArtifacts(config, directory);
    validateResources(application, models);
    const built = await readFile(entry);

    return {
        manifestVersion: MANIFEST_VERSION,
        nestrumVersion: await cliVersion(),
        builtAt: new Date().toISOString(),
        runtime: { adapter: RUNTIME_ADAPTER },
        entry: { path: SERVER_ENTRY, sha256: sha256(built) },
        apps: application.apps.all().map((app) => app.name),
        resources: application.resources.all().length,
        auth: application.authConfigured,
        admin: application.adminConfigured ? { package: ADMIN_UI_PACKAGE } : null,
        databases,
        server: { ...(config.server ?? {}) },
    };
}
