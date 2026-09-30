import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineApplication } from '@nestrum/core';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaProviderExtension } from '../src/node.js';
import { assemblePrismaContracts, generatePrismaContracts, writePrismaWorkflowConfig } from '../src/node.js';

const application = () =>
    defineApplication({
        apps: [
            {
                name: 'app',
                prisma: { default: ['missing-unselected.prisma'] },
                prismaSource: { documents: 'model Article {\n id ObjectId @id @map("_id")\n}\n' },
            },
        ],
        databases: {
            default: { kind: 'prisma', provider: 'postgresql', connection: 'postgresql://secret' },
            documents: { kind: 'prisma', provider: 'mongodb', connection: 'mongodb://secret' },
        },
    });
const extension: PrismaProviderExtension = {
    owner: 'search',
    name: 'search-fields',
    database: 'documents',
    provider: 'mongodb',
    contribute: () => 'model SearchTerm {\n id ObjectId @id @map("_id")\n term String\n}\n',
};

describe('Provider extension and targeting seams', () => {
    it('isolates selected fragments and preserves extension provenance', async () => {
        const contracts = await assemblePrismaContracts(application(), {
            rootDir: '.',
            database: 'documents',
            extensions: [extension],
        });
        expect(contracts).toHaveLength(1);
        expect(contracts[0]?.source).toContain('SearchTerm');
        expect(contracts[0]?.fragments.at(-1)).toMatchObject({ app: 'search', path: 'extension:search-fields' });
    });
    it.each(
        [
            [{ ...extension, provider: 'postgresql' }],
            [extension, extension],
            [{ ...extension, database: 'unknown' }],
            [{ ...extension, name: '../unsafe' }],
        ].map((extensions) => ({ extensions })),
    )('rejects mismatched or conflicting extensions before invoking them: %j', async ({ extensions }) => {
        const contribute = vi.fn(extension.contribute);
        await expect(
            assemblePrismaContracts(application(), {
                rootDir: '.',
                database: 'documents',
                extensions: extensions.map((value) => ({ ...value, contribute })) as PrismaProviderExtension[],
            }),
        ).rejects.toMatchObject({ code: 'PRISMA_EXTENSION_INVALID' });
        expect(contribute).not.toHaveBeenCalled();
    });
    it('fails closed on contributor validation errors', async () => {
        await expect(
            assemblePrismaContracts(application(), {
                rootDir: '.',
                database: 'documents',
                extensions: [
                    {
                        ...extension,
                        contribute: () => {
                            throw new Error('unsupported compression');
                        },
                    },
                ],
            }),
        ).rejects.toMatchObject({ code: 'PRISMA_EXTENSION_INVALID', cause: expect.any(Error) });
    });
    it('emits extended native contracts and workflow config without persisting connection settings', async () => {
        const rootDir = await mkdtemp(join(tmpdir(), 'nestrum-provider-'));
        try {
            const generated = await generatePrismaContracts(application(), {
                rootDir,
                outputDir: 'out',
                database: 'documents',
                extensions: [extension],
            });
            const contract = generated.contracts[0];
            expect(contract).toBeDefined();
            if (!contract) {
                throw new Error('No contract');
            }
            expect(await readFile(contract.contractPath, 'utf8')).toContain('SearchTerm');
            const workflow = await writePrismaWorkflowConfig(contract, join(rootDir, 'migrations/documents'));
            const config = await readFile(workflow, 'utf8');
            expect(config).toContain('NESTRUM_DATABASE_CONNECTION');
            expect(config).not.toContain('mongodb://secret');
            expect(config).toContain('migrations/documents');
            await writeFile(join(rootDir, 'invalid-control.mjs'), 'export default null;\n');
            await expect(
                generatePrismaContracts(application(), {
                    rootDir,
                    outputDir: 'invalid',
                    database: 'documents',
                    extensions: [
                        {
                            owner: 'storage',
                            name: 'physical-options',
                            database: 'documents',
                            provider: 'mongodb',
                            controlModule: 'invalid-control.mjs',
                        },
                    ],
                }),
            ).rejects.toMatchObject({ code: 'PRISMA_EMIT_FAILED' });
        } finally {
            await rm(rootDir, { recursive: true, force: true });
        }
    }, 30_000);
});
