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

/** Assembles the application's one Prisma contract from app fragments, inline sources and provider extensions. */
export async function assemblePrismaContract(
    application: ContractApplication,
    options: AssemblePrismaOptions,
): Promise<PrismaContract | undefined> {
    const fragments: PrismaFragment[] = [];
    const owners = new Map<string, PrismaFragment>();
    if (options.extensions !== undefined && !Array.isArray(options.extensions)) {
        throw new PrismaContractError('PRISMA_EXTENSION_INVALID', 'Provider extensions must be an explicit array.');
    }

    for (const app of application.apps.all()) {
        if (app.prismaSource !== undefined) {
            fragments.push(Object.freeze({ app: app.name, path: `${app.name}:inline`, content: app.prismaSource }));
        }
        for (const input of app.prisma ?? []) {
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
                    const owner = owners.get(canonicalPath);

                    if (owner) {
                        throw new PrismaContractError(
                            'PRISMA_FRAGMENT_DUPLICATE',
                            `The database receives ${canonicalPath} twice, from apps "${owner.app}" and "${app.name}".`,
                        );
                    }

                    const fragment = Object.freeze({
                        app: app.name,
                        path: canonicalPath,
                        content: await readFile(canonicalPath, 'utf8'),
                    });
                    owners.set(canonicalPath, fragment);
                    fragments.push(fragment);
                }
            } catch (cause) {
                if (cause instanceof PrismaContractError) {
                    throw cause;
                }

                throw new PrismaContractError(
                    'PRISMA_FRAGMENT_READ_FAILED',
                    `Cannot read Prisma contribution for app "${app.name}": ${path}`,
                    { cause },
                );
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
            application.database.provider !== extension.provider ||
            (extension.contribute !== undefined && typeof extension.contribute !== 'function') ||
            (extension.controlModule !== undefined &&
                (typeof extension.controlModule !== 'string' || !extension.controlModule.trim())) ||
            (extension.contribute === undefined && extension.controlModule === undefined) ||
            extensions.has(extension.name)
        ) {
            throw new PrismaContractError(
                'PRISMA_EXTENSION_INVALID',
                'Provider extensions require an owner, unique name, matching provider, and contributor.',
            );
        }
        extensions.add(extension.name);
    }
    for (const extension of options.extensions ?? []) {
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
        fragments.push(Object.freeze({ app: extension.owner, path: `extension:${extension.name}`, content }));
    }

    if (fragments.length === 0) {
        return undefined;
    }

    return Object.freeze({
        provider: application.database.provider,
        fragments: Object.freeze(fragments),
        source: `// use prisma-8\n\n${fragments
            .map(
                (fragment) =>
                    `// Nestrum source: ${JSON.stringify({ app: fragment.app, path: fragment.path })}\n${fragment.content.replace(/^\uFEFF/, '')}\n`,
            )
            .join('\n')}`,
    });
}
