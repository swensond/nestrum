import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppDefinition } from '@nestrum/core';
import { defineApp, defineApplication } from '@nestrum/core';
import { afterEach, describe, expect, it } from 'vitest';
import { prismaDatabase } from '../src/index.js';
import { assemblePrismaContract, generatePrismaContract, PrismaContractError } from '../src/node.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const DATABASE = prismaDatabase({ provider: 'postgresql', connection: 'postgresql://unused/never-connected' });
const DIRECTORIES: string[] = [];

async function temporaryDirectory(): Promise<string> {
    const path = await mkdtemp(join(tmpdir(), 'nestrum-contract-test-'));
    DIRECTORIES.push(path);

    return path;
}

function application(apps: readonly AppDefinition[]) {
    return defineApplication({ apps, database: DATABASE });
}

function example() {
    return application([
        defineApp({ name: 'projects', dependsOn: ['users'], prisma: ['apps/projects/prisma'] }),
        defineApp({ name: 'users', prisma: ['apps/users/prisma'] }),
    ]);
}

function modelNames(content: string): string[] {
    const contract = JSON.parse(content) as {
        domain: { namespaces: Record<string, { models?: Record<string, unknown> }> };
    };

    return Object.values(contract.domain.namespaces)
        .flatMap((namespace) => Object.keys(namespace.models ?? {}))
        .sort();
}

afterEach(async () => {
    for (const directory of DIRECTORIES.splice(0)) {
        await rm(directory, { recursive: true, force: true });
    }
});

describe('Prisma fragment assembly', () => {
    it('collects explicit registered apps in dependency order', async () => {
        const contract = await assemblePrismaContract(example(), { rootDir: FIXTURES });

        expect(contract?.provider).toBe('postgresql');
        expect(contract?.fragments.map((fragment) => fragment.app)).toEqual(['users', 'projects', 'projects']);
        expect(contract?.fragments.map((fragment) => fragment.path.split('/').at(-1))).toEqual([
            'user.prisma',
            'project-member.prisma',
            'project.prisma',
        ]);
        expect(contract?.source.startsWith('// use prisma-8\n')).toBe(true);
        expect(Object.isFrozen(contract)).toBe(true);
        expect(Object.isFrozen(contract?.fragments)).toBe(true);
    });

    it('assembles deterministically and supports explicit files as well as directories', async () => {
        const app = application([defineApp({ name: 'users', prisma: ['apps/users/prisma/user.prisma'] })]);
        const first = await assemblePrismaContract(app, { rootDir: FIXTURES });
        const second = await assemblePrismaContract(app, { rootDir: FIXTURES });

        expect(second).toEqual(first);
        expect(first?.fragments).toHaveLength(1);
        expect(first?.source).toContain('"app":"users"');
    });

    it('includes inline app sources', async () => {
        const contract = await assemblePrismaContract(
            application([defineApp({ name: 'inline', prismaSource: 'model Thing {\n id Int @id\n}\n' })]),
            { rootDir: FIXTURES },
        );

        expect(contract?.fragments.map((fragment) => fragment.path)).toEqual(['inline:inline']);
    });

    it('does not discover fragments for apps without explicit contributions', async () => {
        expect(
            await assemblePrismaContract(application([defineApp({ name: 'users' })]), { rootDir: FIXTURES }),
        ).toBeUndefined();
    });

    it('reports missing files with app, path, and original cause', async () => {
        await expect(
            assemblePrismaContract(application([defineApp({ name: 'users', prisma: ['missing.prisma'] })]), {
                rootDir: FIXTURES,
            }),
        ).rejects.toMatchObject({
            code: 'PRISMA_FRAGMENT_READ_FAILED',
            cause: expect.objectContaining({ code: 'ENOENT' }),
        });
    });

    it('rejects empty directories and explicit non-Prisma files', async () => {
        const rootDir = await temporaryDirectory();
        await mkdir(join(rootDir, 'empty'));
        await writeFile(join(rootDir, 'note.txt'), 'not a contract');

        await expect(
            assemblePrismaContract(application([{ name: 'empty', prisma: ['empty'] }]), { rootDir }),
        ).rejects.toMatchObject({ code: 'PRISMA_FRAGMENTS_EMPTY' });
        await expect(
            assemblePrismaContract(application([{ name: 'note', prisma: ['note.txt'] }]), { rootDir }),
        ).rejects.toMatchObject({ code: 'PRISMA_FRAGMENT_PATH_INVALID' });
    });

    it('rejects overlapping file/directory contributions and duplicate ownership', async () => {
        const app = application([
            { name: 'users', prisma: ['apps/users/prisma'] },
            { name: 'other', prisma: ['apps/users/prisma/user.prisma'] },
        ]);

        await expect(assemblePrismaContract(app, { rootDir: FIXTURES })).rejects.toMatchObject({
            code: 'PRISMA_FRAGMENT_DUPLICATE',
        });
        await expect(assemblePrismaContract(app, { rootDir: FIXTURES })).rejects.toThrow('apps "users" and "other"');
    });

    it('skips symlinks during recursion and rejects explicitly declared symlink paths', async () => {
        const rootDir = await temporaryDirectory();
        await writeFile(join(rootDir, 'user.prisma'), 'model User {\n id Int @id\n}\n');
        await symlink(rootDir, join(rootDir, 'loop'), 'dir');
        const contract = await assemblePrismaContract(application([{ name: 'users', prisma: ['.'] }]), { rootDir });

        expect(contract?.fragments).toHaveLength(1);
        await expect(
            assemblePrismaContract(application([{ name: 'users', prisma: ['loop'] }]), { rootDir }),
        ).rejects.toMatchObject({ code: 'PRISMA_FRAGMENT_PATH_INVALID' });
    });

    it('snapshots app-owned path lists', async () => {
        const paths = ['apps/users/prisma'];
        const app = defineApp({ name: 'users', prisma: paths });
        paths.push('missing');

        expect(Object.isFrozen(app.prisma)).toBe(true);
        expect((await assemblePrismaContract(application([app]), { rootDir: FIXTURES }))?.fragments).toHaveLength(1);
    });

    it.each([[[]], [['']], [['  ']], ['directory'], [{ default: ['a'] }]])(
        'rejects malformed app contribution path lists: %j',
        (paths) => {
            expect(() => defineApp({ name: 'invalid', prisma: paths } as unknown as AppDefinition)).toThrow(
                expect.objectContaining({ code: 'INVALID_PRISMA_CONTRIBUTION' }),
            );
        },
    );

    it.each([[''], ['  '], [42]])('rejects malformed inline Prisma sources: %j', (source) => {
        expect(() => defineApp({ name: 'invalid', prismaSource: source } as unknown as AppDefinition)).toThrow(
            expect.objectContaining({ code: 'INVALID_PRISMA_CONTRIBUTION' }),
        );
    });
});

describe('Real Prisma 8 contract generation', () => {
    it('emits the exact PostgreSQL model set without a database connection', async () => {
        const outputDir = await temporaryDirectory();
        const generation = await generatePrismaContract(example(), { rootDir: FIXTURES, outputDir });
        const { contract } = generation;

        expect(modelNames(await readFile(contract.contractPath, 'utf8'))).toEqual(['Project', 'ProjectMember', 'User']);
        expect((await readFile(contract.typesPath, 'utf8')).length).toBeGreaterThan(0);
        expect(await readFile(contract.configPath, 'utf8')).not.toContain('never-connected');
        expect(await readFile(contract.sourcePath, 'utf8')).toBe(contract.source);

        const repeated = await generatePrismaContract(example(), { rootDir: FIXTURES, outputDir });
        expect(repeated.directory).not.toBe(generation.directory);
        expect(await readFile(repeated.contract.contractPath, 'utf8')).toBe(
            await readFile(contract.contractPath, 'utf8'),
        );
    }, 30_000);

    it.each(['', ' name String\n'])(
        'rejects duplicate/conflicting model declarations with native diagnostics (%j)',
        async (extraField) => {
            const rootDir = await temporaryDirectory();
            await writeFile(join(rootDir, 'one.prisma'), 'model User {\n id Int @id\n}\n');
            await writeFile(join(rootDir, 'two.prisma'), `model User {\n id Int @id\n${extraField}}\n`);
            const app = application([
                { name: 'one', prisma: ['one.prisma'] },
                { name: 'two', prisma: ['two.prisma'] },
            ]);

            const error = await generatePrismaContract(app, { rootDir, outputDir: 'generated' }).then(
                () => {
                    throw new Error('Expected duplicate declaration failure.');
                },
                (cause: unknown) => cause,
            );
            expect(error).toBeInstanceOf(PrismaContractError);
            expect(error).toMatchObject({ code: 'PRISMA_EMIT_FAILED' });

            if (error instanceof Error) {
                expect(error.message).toMatch(/duplicate|already.*defined/i);
                expect(error.message).toContain('one:');
                expect(error.message).toContain('two:');
            }
        },
        30_000,
    );

    it('rejects unresolved model references instead of emulating relations', async () => {
        const rootDir = await temporaryDirectory();
        await writeFile(
            join(rootDir, 'broken.prisma'),
            'model Project {\n id Int @id\n ownerId Int\n owner MissingUser @relation(fields: [ownerId], references: [id])\n}\n',
        );

        await expect(
            generatePrismaContract(application([{ name: 'projects', prisma: ['broken.prisma'] }]), {
                rootDir,
                outputDir: 'generated',
            }),
        ).rejects.toMatchObject({ code: 'PRISMA_EMIT_FAILED' });
    }, 30_000);

    it('rejects empty generation before writing output', async () => {
        const rootDir = await temporaryDirectory();

        await expect(
            generatePrismaContract(application([]), { rootDir, outputDir: 'generated' }),
        ).rejects.toMatchObject({ code: 'PRISMA_FRAGMENTS_EMPTY' });
    });

    it('reports unsupported legacy updatedAt syntax instead of silently altering fragments', async () => {
        const rootDir = await temporaryDirectory();
        await writeFile(
            join(rootDir, 'legacy.prisma'),
            'model Project {\n id Int @id\n updatedAt DateTime @updatedAt\n}\n',
        );

        await expect(
            generatePrismaContract(application([{ name: 'projects', prisma: ['legacy.prisma'] }]), {
                rootDir,
                outputDir: 'generated',
            }),
        ).rejects.toThrow('@updatedAt');
    }, 30_000);

    it('reports output errors without overwriting an existing file', async () => {
        const rootDir = await temporaryDirectory();
        const outputDir = join(rootDir, 'existing-file');
        await writeFile(outputDir, 'preserve me');

        await expect(generatePrismaContract(example(), { rootDir: FIXTURES, outputDir })).rejects.toMatchObject({
            code: 'PRISMA_OUTPUT_FAILED',
        });
        expect(await readFile(outputDir, 'utf8')).toBe('preserve me');
    });
});
