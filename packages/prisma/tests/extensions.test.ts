import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineApplication } from '@nestrum/core';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaProviderExtension } from '../src/node.js';
import { assemblePrismaContract, generatePrismaContract, writePrismaWorkflowConfig } from '../src/node.js';

const application = () =>
    defineApplication({
        apps: [
            {
                name: 'app',
                prismaSource: 'model Article {\n id Int @id\n}\n',
            },
        ],
        database: { kind: 'prisma', provider: 'postgresql', connection: 'postgresql://secret' },
    });
const extension: PrismaProviderExtension = {
    owner: 'search',
    name: 'search-fields',
    provider: 'postgresql',
    contribute: () => 'model SearchTerm {\n id Int @id\n term String\n}\n',
};

describe('Provider extension and targeting seams', () => {
    it('preserves extension provenance', async () => {
        const contract = await assemblePrismaContract(application(), {
            rootDir: '.',
            extensions: [extension],
        });
        expect(contract?.source).toContain('SearchTerm');
        expect(contract?.fragments.at(-1)).toMatchObject({ app: 'search', path: 'extension:search-fields' });
    });
    it.each(
        [[{ ...extension, provider: 'mongodb' }], [extension, extension], [{ ...extension, name: '../unsafe' }]].map(
            (extensions) => ({ extensions }),
        ),
    )('rejects mismatched or conflicting extensions before invoking them: %j', async ({ extensions }) => {
        const contribute = vi.fn(extension.contribute);
        await expect(
            assemblePrismaContract(application(), {
                rootDir: '.',
                extensions: extensions.map((value) => ({ ...value, contribute })) as PrismaProviderExtension[],
            }),
        ).rejects.toMatchObject({ code: 'PRISMA_EXTENSION_INVALID' });
        expect(contribute).not.toHaveBeenCalled();
    });
    it('fails closed on contributor validation errors', async () => {
        await expect(
            assemblePrismaContract(application(), {
                rootDir: '.',
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
            const generated = await generatePrismaContract(application(), {
                rootDir,
                outputDir: 'out',
                extensions: [extension],
            });
            const { contract } = generated;
            expect(await readFile(contract.contractPath, 'utf8')).toContain('SearchTerm');
            const workflow = await writePrismaWorkflowConfig(contract, join(rootDir, 'migrations'));
            const config = await readFile(workflow, 'utf8');
            expect(config).toContain('NESTRUM_DATABASE_CONNECTION');
            expect(config).not.toContain('postgresql://secret');
            expect(config).toContain('migrations');
            await writeFile(join(rootDir, 'invalid-control.mjs'), 'export default null;\n');
            await expect(
                generatePrismaContract(application(), {
                    rootDir,
                    outputDir: 'invalid',
                    extensions: [
                        {
                            owner: 'storage',
                            name: 'physical-options',
                            provider: 'postgresql',
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
