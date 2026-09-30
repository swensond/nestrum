import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PrismaContractError } from './contracts.errors.js';
import type { AssemblePrismaOptions, ContractApplication, PrismaContract, PrismaFragment } from './contracts.types.js';

async function discover(path: string): Promise<string[]> {
    const stat = await lstat(path);

    if (stat.isSymbolicLink()) {
        throw new PrismaContractError(
            'PRISMA_FRAGMENT_PATH_INVALID',
            `Explicit Prisma paths cannot be symbolic links: ${path}`,
        );
    }

    if (stat.isFile() && path.endsWith('.prisma')) {
        return [path];
    }

    if (!stat.isDirectory()) {
        throw new PrismaContractError(
            'PRISMA_FRAGMENT_PATH_INVALID',
            `Prisma contribution must be a .prisma file or directory: ${path}`,
        );
    }

    const entries = await readdir(path, { withFileTypes: true });
    const byName = new Map(entries.map((entry) => [entry.name, entry]));
    const files: string[] = [];

    for (const name of [...byName.keys()].sort()) {
        const entry = byName.get(name);

        if (entry?.isDirectory()) {
            files.push(...(await discover(join(path, name))));
        } else if (entry?.isFile() && name.endsWith('.prisma')) {
            files.push(join(path, name));
        }
    }

    return files;
}

export async function assemblePrismaContracts(
    application: ContractApplication,
    options: AssemblePrismaOptions,
): Promise<readonly PrismaContract[]> {
    const fragments = new Map<string, PrismaFragment[]>();
    const owners = new Map<string, PrismaFragment>();
    if (options.extensions !== undefined && !Array.isArray(options.extensions)) {
        throw new PrismaContractError('PRISMA_EXTENSION_INVALID', 'Provider extensions must be an explicit array.');
    }
    if (options.database !== undefined && !application.databases.has(options.database)) {
        throw new PrismaContractError('PRISMA_DATABASE_UNKNOWN', 'Selected database is not registered.');
    }

    for (const app of application.apps.all()) {
        for (const [database, content] of Object.entries(app.prismaSource ?? {}).sort(([left], [right]) =>
            left.localeCompare(right),
        )) {
            if (!application.databases.has(database)) {
                throw new PrismaContractError(
                    'PRISMA_DATABASE_UNKNOWN',
                    `App "${app.name}" contributes inline fragments to an unregistered database.`,
                );
            }
            if (options.database !== undefined && database !== options.database) {
                continue;
            }
            const group = fragments.get(database) ?? [];
            group.push(Object.freeze({ app: app.name, path: `${app.name}:inline:${database}`, content }));
            fragments.set(database, group);
        }
        for (const database of Object.keys(app.prisma ?? {}).sort()) {
            if (!application.databases.has(database)) {
                throw new PrismaContractError(
                    'PRISMA_DATABASE_UNKNOWN',
                    `App "${app.name}" contributes Prisma fragments to unregistered database "${database}".`,
                );
            }
            if (options.database !== undefined && database !== options.database) {
                continue;
            }

            for (const input of app.prisma?.[database] ?? []) {
                const path = resolve(options.rootDir, input);

                try {
                    const files = await discover(path);

                    if (files.length === 0) {
                        throw new PrismaContractError(
                            'PRISMA_FRAGMENTS_EMPTY',
                            `App "${app.name}" Prisma path contains no regular .prisma files: ${path}`,
                        );
                    }

                    for (const file of files) {
                        const canonicalPath = await realpath(file);
                        const key = `${database}\0${canonicalPath}`;
                        const owner = owners.get(key);

                        if (owner) {
                            throw new PrismaContractError(
                                'PRISMA_FRAGMENT_DUPLICATE',
                                `Database "${database}" receives ${canonicalPath} twice, from apps "${owner.app}" and "${app.name}".`,
                            );
                        }

                        const fragment = Object.freeze({
                            app: app.name,
                            path: canonicalPath,
                            content: await readFile(canonicalPath, 'utf8'),
                        });
                        owners.set(key, fragment);
                        const group = fragments.get(database) ?? [];
                        group.push(fragment);
                        fragments.set(database, group);
                    }
                } catch (cause) {
                    if (cause instanceof PrismaContractError) {
                        throw cause;
                    }

                    throw new PrismaContractError(
                        'PRISMA_FRAGMENT_READ_FAILED',
                        `Cannot read Prisma contribution for app "${app.name}", database "${database}": ${path}`,
                        { cause },
                    );
                }
            }
        }
    }

    const extensions = new Set<string>();
    for (const extension of options.extensions ?? []) {
        if (
            !extension ||
            typeof extension.owner !== 'string' ||
            !extension.owner.trim() ||
            typeof extension.name !== 'string' ||
            !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(extension.name) ||
            !application.databases.has(extension.database) ||
            application.databases.get(extension.database).provider !== extension.provider ||
            (extension.contribute !== undefined && typeof extension.contribute !== 'function') ||
            (extension.controlModule !== undefined &&
                (typeof extension.controlModule !== 'string' || !extension.controlModule.trim())) ||
            (extension.contribute === undefined && extension.controlModule === undefined) ||
            extensions.has(`${extension.database}:${extension.name}`)
        ) {
            throw new PrismaContractError(
                'PRISMA_EXTENSION_INVALID',
                'Provider extensions require an owner, unique name, matching database/provider, and contributor.',
            );
        }
        extensions.add(`${extension.database}:${extension.name}`);
    }
    for (const extension of options.extensions ?? []) {
        if (options.database !== undefined && extension.database !== options.database) {
            continue;
        }
        if (!extension.contribute) {
            continue;
        }
        let content: string;
        try {
            content = await extension.contribute();
            if (typeof content !== 'string' || !content.trim()) {
                throw new Error('Extension contributions must be nonempty Prisma source.');
            }
        } catch (cause) {
            throw new PrismaContractError(
                'PRISMA_EXTENSION_INVALID',
                `Provider extension ${extension.name} failed validation/contribution.`,
                { cause },
            );
        }
        const group = fragments.get(extension.database) ?? [];
        group.push(Object.freeze({ app: extension.owner, path: `extension:${extension.name}`, content }));
        fragments.set(extension.database, group);
    }

    return Object.freeze(
        application.databases
            .names()
            .filter((database) => fragments.has(database))
            .map((database) =>
                Object.freeze({
                    database,
                    provider: application.databases.get(database).provider,
                    fragments: Object.freeze(fragments.get(database) ?? []),
                    source: `// use prisma-8\n\n${(fragments.get(database) ?? [])
                        .map(
                            (fragment) =>
                                `// Nestrum source: ${JSON.stringify({ app: fragment.app, path: fragment.path })}\n${fragment.content.replace(/^\uFEFF/, '')}\n`,
                        )
                        .join('\n')}`,
                }),
            ),
    );
}
