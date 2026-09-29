import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineApp, defineApplication } from '@nestrum/core';
import { prismaDatabase } from '../src/index.js';
import { assemblePrismaContracts, generatePrismaContracts, PrismaContractError } from '../src/node.js';
import type { AppDefinition } from '@nestrum/core';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const DATABASES = {
    default: prismaDatabase({ provider: 'postgresql', connection: 'postgresql://unused/never-connected' }),
    documents: prismaDatabase({ provider: 'mongodb', connection: 'mongodb://unused/never-connected' })
};
const DIRECTORIES: string[] = [];

async function temporaryDirectory(): Promise<string> {
    const path = await mkdtemp(join(tmpdir(), 'nestrum-contract-test-'));
    DIRECTORIES.push(path);

    return path;
}

function application(apps: readonly AppDefinition[]) {
    return defineApplication({ apps, databases: DATABASES });
}

function example() {
    return application([
        defineApp({ name: 'projects', dependsOn: ['users'], prisma: { default: ['apps/projects/prisma'] } }),
        defineApp({ name: 'articles', prisma: { documents: ['apps/articles/prisma'] } }),
        defineApp({ name: 'users', prisma: { default: ['apps/users/prisma'] } })
    ]);
}

function modelNames(content: string): string[] {
    const contract = JSON.parse(content) as { domain: { namespaces: Record<string, { models?: Record<string, unknown> }> } };

    return Object.values(contract.domain.namespaces).flatMap((namespace) => Object.keys(namespace.models ?? {})).sort();
}

afterEach(async () => {
    for (const directory of DIRECTORIES.splice(0)) {
        await rm(directory, { recursive: true, force: true });
    }
});

describe('Prisma fragment assembly', () => {
    it('collects explicit registered apps in dependency order and groups by named database', async () => {
        const contracts = await assemblePrismaContracts(example(), { rootDir: FIXTURES });

        expect(contracts.map((contract) => contract.database)).toEqual(['default', 'documents']);
        expect(contracts[0]?.fragments.map((fragment) => fragment.app)).toEqual(['users', 'projects', 'projects']);
        expect(contracts[0]?.fragments.map((fragment) => fragment.path.split('/').at(-1))).toEqual(['user.prisma', 'project-member.prisma', 'project.prisma']);
        expect(contracts[1]?.fragments.map((fragment) => fragment.app)).toEqual(['articles']);
        expect(contracts[0]?.source.startsWith('// use prisma-8\n')).toBe(true);
        expect(Object.isFrozen(contracts)).toBe(true);
        expect(Object.isFrozen(contracts[0]?.fragments)).toBe(true);
    });

    it('assembles deterministically and supports explicit files as well as directories', async () => {
        const app = application([defineApp({ name: 'users', prisma: { default: ['apps/users/prisma/user.prisma'] } })]);
        const first = await assemblePrismaContracts(app, { rootDir: FIXTURES });
        const second = await assemblePrismaContracts(app, { rootDir: FIXTURES });

        expect(second).toEqual(first);
        expect(first[0]?.fragments).toHaveLength(1);
        expect(first[0]?.source).toContain('"app":"users"');
    });

    it('does not discover fragments for apps without explicit contributions', async () => {
        expect(await assemblePrismaContracts(application([defineApp({ name: 'users' })]), { rootDir: FIXTURES })).toEqual([]);
    });

    it('rejects unregistered target databases with app/database identity', async () => {
        const app = application([defineApp({ name: 'projects', prisma: { missing: ['apps/projects/prisma'] } })]);

        await expect(assemblePrismaContracts(app, { rootDir: FIXTURES })).rejects.toMatchObject({ code: 'PRISMA_DATABASE_UNKNOWN' });
        await expect(assemblePrismaContracts(app, { rootDir: FIXTURES })).rejects.toThrow('App "projects"');
    });

    it('reports missing files with app, database, path, and original cause', async () => {
        await expect(assemblePrismaContracts(application([defineApp({ name: 'users', prisma: { default: ['missing.prisma'] } })]), { rootDir: FIXTURES })).rejects.toMatchObject({
            code: 'PRISMA_FRAGMENT_READ_FAILED',
            cause: expect.objectContaining({ code: 'ENOENT' })
        });
    });

    it('rejects empty directories and explicit non-Prisma files', async () => {
        const rootDir = await temporaryDirectory();
        await mkdir(join(rootDir, 'empty'));
        await writeFile(join(rootDir, 'note.txt'), 'not a contract');

        await expect(assemblePrismaContracts(application([{ name: 'empty', prisma: { default: ['empty'] } }]), { rootDir })).rejects.toMatchObject({ code: 'PRISMA_FRAGMENTS_EMPTY' });
        await expect(assemblePrismaContracts(application([{ name: 'note', prisma: { default: ['note.txt'] } }]), { rootDir })).rejects.toMatchObject({ code: 'PRISMA_FRAGMENT_PATH_INVALID' });
    });

    it('rejects overlapping file/directory contributions and duplicate ownership within one database', async () => {
        const app = application([
            { name: 'users', prisma: { default: ['apps/users/prisma'] } },
            { name: 'other', prisma: { default: ['apps/users/prisma/user.prisma'] } }
        ]);

        await expect(assemblePrismaContracts(app, { rootDir: FIXTURES })).rejects.toMatchObject({ code: 'PRISMA_FRAGMENT_DUPLICATE' });
        await expect(assemblePrismaContracts(app, { rootDir: FIXTURES })).rejects.toThrow('apps "users" and "other"');
    });

    it('permits reuse under different database identities', async () => {
        const contracts = await assemblePrismaContracts(application([{ name: 'shared', prisma: {
            default: ['apps/users/prisma/user.prisma'], documents: ['apps/users/prisma/user.prisma']
        } }]), { rootDir: FIXTURES });

        expect(contracts).toHaveLength(2);
    });

    it('skips symlinks during recursion and rejects explicitly declared symlink paths', async () => {
        const rootDir = await temporaryDirectory();
        await writeFile(join(rootDir, 'user.prisma'), 'model User {\n id Int @id\n}\n');
        await symlink(rootDir, join(rootDir, 'loop'), 'dir');
        const contracts = await assemblePrismaContracts(application([{ name: 'users', prisma: { default: ['.'] } }]), { rootDir });

        expect(contracts[0]?.fragments).toHaveLength(1);
        await expect(assemblePrismaContracts(application([{ name: 'users', prisma: { default: ['loop'] } }]), { rootDir })).rejects.toMatchObject({ code: 'PRISMA_FRAGMENT_PATH_INVALID' });
    });

    it('snapshots app-owned contribution maps and path lists', async () => {
        const paths = ['apps/users/prisma'];
        const prisma = { default: paths };
        const app = defineApp({ name: 'users', prisma });
        paths.push('missing');
        prisma.default = ['other'];

        expect(Object.isFrozen(app.prisma)).toBe(true);
        expect(Object.isFrozen(app.prisma?.default)).toBe(true);
        expect((await assemblePrismaContracts(application([app]), { rootDir: FIXTURES }))[0]?.fragments).toHaveLength(1);
    });

    it.each([[], [''], ['  '], 'directory'])('rejects malformed app contribution path lists: %j', (paths) => {
        expect(() => defineApp({ name: 'invalid', prisma: { default: paths } } as unknown as AppDefinition)).toThrow(expect.objectContaining({ code: 'INVALID_PRISMA_CONTRIBUTION' }));
    });
});

describe('Real Prisma 8 contract generation', () => {
    it('emits exact PostgreSQL and MongoDB model sets without database connections', async () => {
        const outputDir = await temporaryDirectory();
        const generation = await generatePrismaContracts(example(), { rootDir: FIXTURES, outputDir });

        expect(generation.contracts.map((contract) => contract.database)).toEqual(['default', 'documents']);
        for (const contract of generation.contracts) {
            const names = modelNames(await readFile(contract.contractPath, 'utf8'));
            expect(names).toEqual(contract.database === 'default' ? ['Project', 'ProjectMember', 'User'] : ['Article']);
            expect((await readFile(contract.typesPath, 'utf8')).length).toBeGreaterThan(0);
            expect(await readFile(contract.configPath, 'utf8')).not.toContain('never-connected');
            expect(await readFile(contract.sourcePath, 'utf8')).toBe(contract.source);
        }

        const repeated = await generatePrismaContracts(example(), { rootDir: FIXTURES, outputDir });
        expect(repeated.directory).not.toBe(generation.directory);
        for (const [index, contract] of repeated.contracts.entries()) {
            const previous = generation.contracts[index];
            expect(previous).toBeDefined();
            expect(await readFile(contract.contractPath, 'utf8')).toBe(await readFile(previous!.contractPath, 'utf8'));
        }
    }, 30_000);

    it.each(['', ' name String\n'])('rejects duplicate/conflicting model declarations with native diagnostics (%j)', async (extraField) => {
        const rootDir = await temporaryDirectory();
        await writeFile(join(rootDir, 'one.prisma'), 'model User {\n id Int @id\n}\n');
        await writeFile(join(rootDir, 'two.prisma'), `model User {\n id Int @id\n${extraField}}\n`);
        const app = application([{ name: 'one', prisma: { default: ['one.prisma'] } }, { name: 'two', prisma: { default: ['two.prisma'] } }]);

        const error = await generatePrismaContracts(app, { rootDir, outputDir: 'generated' }).then(
            () => { throw new Error('Expected duplicate declaration failure.'); },
            (cause: unknown) => cause
        );
        expect(error).toBeInstanceOf(PrismaContractError);
        expect(error).toMatchObject({ code: 'PRISMA_EMIT_FAILED' });

        if (error instanceof Error) {
            expect(error.message).toMatch(/duplicate|already.*defined/i);
            expect(error.message).toContain('one:');
            expect(error.message).toContain('two:');
        }
    }, 30_000);

    it('rejects unresolved cross-database model references instead of emulating relations', async () => {
        const rootDir = await temporaryDirectory();
        await writeFile(join(rootDir, 'broken.prisma'), 'model Project {\n id Int @id\n ownerId Int\n owner MissingUser @relation(fields: [ownerId], references: [id])\n}\n');

        await expect(generatePrismaContracts(application([{ name: 'projects', prisma: { default: ['broken.prisma'] } }]), { rootDir, outputDir: 'generated' })).rejects.toMatchObject({ code: 'PRISMA_EMIT_FAILED' });
    }, 30_000);

    it('rejects empty generation before writing output', async () => {
        const rootDir = await temporaryDirectory();

        await expect(generatePrismaContracts(application([]), { rootDir, outputDir: 'generated' })).rejects.toMatchObject({ code: 'PRISMA_FRAGMENTS_EMPTY' });
    });

    it('reports unsupported legacy updatedAt syntax instead of silently altering fragments', async () => {
        const rootDir = await temporaryDirectory();
        await writeFile(join(rootDir, 'legacy.prisma'), 'model Project {\n id Int @id\n updatedAt DateTime @updatedAt\n}\n');

        await expect(generatePrismaContracts(application([{ name: 'projects', prisma: { default: ['legacy.prisma'] } }]), { rootDir, outputDir: 'generated' })).rejects.toThrow('@updatedAt');
    }, 30_000);

    it('reports output errors without overwriting an existing file', async () => {
        const rootDir = await temporaryDirectory();
        const outputDir = join(rootDir, 'existing-file');
        await writeFile(outputDir, 'preserve me');

        await expect(generatePrismaContracts(example(), { rootDir: FIXTURES, outputDir })).rejects.toMatchObject({ code: 'PRISMA_OUTPUT_FAILED' });
        expect(await readFile(outputDir, 'utf8')).toBe('preserve me');
    });
});
