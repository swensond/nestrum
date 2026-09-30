import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readManifest, runBuild } from '../src/index.js';

const roots: string[] = [];
const PROJECT = 'model Project {\n id Int @id\n name String\n}\n';

/** Projects live inside the package so bundled bare imports resolve through the workspace node_modules. */
async function project(files: Record<string, string>): Promise<string> {
    const root = await mkdtemp(join(import.meta.dirname, '..', '.tmp-build-'));
    roots.push(root);
    for (const [name, content] of Object.entries(files)) {
        await mkdir(join(root, name, '..'), { recursive: true });
        await writeFile(join(root, name), content);
    }

    return root;
}
afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const config = (body: string) => `import { defineApplication, defineResource } from '@nestrum/core';
import { defineConfig } from '@nestrum/cli';
import { helper } from './src/helper';
export default defineConfig({
    application: defineApplication({
        database: { kind: 'prisma', provider: 'postgresql', connection: 'postgresql://user:secret@127.0.0.1:1/x' },
        ${body}
    }),
    server: { port: 4321 },
    timeoutMs: 60000
});
`;
const helper = "export const helper = 'ok' as string;\n";
const valid = config(
    `apps: [{ name: helper === 'ok' ? 'models' : 'x', prismaSource: ${JSON.stringify(PROJECT)}, resources: [defineResource({ model: 'Project' })] }]`,
);

describe('nestrum build', () => {
    it('builds a valid application and writes a complete manifest', async () => {
        const root = await project({ 'nestrum.config.ts': valid, 'src/helper.ts': helper });
        const { manifest, directory } = await runBuild({ cwd: root });

        expect(directory).toBe(join(root, '.nestrum'));
        expect(manifest).toMatchObject({
            manifestVersion: 2,
            apps: ['models'],
            resources: 1,
            auth: false,
            admin: null,
            server: { port: 4321 },
            entry: { path: 'server/index.mjs' },
            database: { provider: 'postgresql' },
        });
        const bundle = await readFile(join(directory, 'server/index.mjs'), 'utf8');
        expect(bundle).toContain('"ok"');
        expect(bundle).not.toContain("from './src/helper'");
        const models = JSON.parse(await readFile(join(directory, manifest.database?.metadata ?? ''), 'utf8'));
        expect(models[0]).toMatchObject({ name: 'Project', identity: 'Project' });
        expect(await readFile(join(directory, manifest.database?.contract ?? ''), 'utf8')).toContain('Project');
        await expect(readManifest(root, manifest.nestrumVersion)).resolves.toMatchObject({ apps: ['models'] });
        expect(JSON.stringify(manifest)).not.toContain('secret');
    });

    it('fails on a resource whose model does not exist and leaves no usable manifest', async () => {
        const root = await project({ 'nestrum.config.ts': valid, 'src/helper.ts': helper });
        const { manifest } = await runBuild({ cwd: root });
        await writeFile(
            join(root, 'nestrum.config.ts'),
            valid.replace("defineResource({ model: 'Project' })", "defineResource({ model: 'Missing' })"),
        );

        await expect(runBuild({ cwd: root })).rejects.toMatchObject({ code: 'BUILD_VALIDATION_FAILED' });
        await expect(readManifest(root, manifest.nestrumVersion)).rejects.toMatchObject({ code: 'BUILD_NOT_FOUND' });
    });

    it('emits into the configured contract directory and keeps a stable copy in the build', async () => {
        const root = await project({
            'nestrum.config.ts': valid.replace(
                'server: { port: 4321 },',
                "server: { port: 4321 }, contractDir: 'emit/here',",
            ),
            'src/helper.ts': helper,
        });
        const { manifest, directory } = await runBuild({ cwd: root });

        expect(manifest.database?.contract).toBe('contracts/database.json');
        expect(await readFile(join(directory, 'contracts/database.json'), 'utf8')).toContain('Project');
        expect((await readdir(join(root, 'emit/here'))).some((entry) => entry.startsWith('run-'))).toBe(true);
        await runBuild({ cwd: root });
        expect((await readdir(join(root, 'emit/here'))).filter((entry) => entry.startsWith('run-'))).toHaveLength(1);
    });

    it('fails on an invalid app dependency graph', async () => {
        const root = await project({
            'nestrum.config.ts': config("apps: [{ name: 'a', dependsOn: ['ghost'] }]"),
            'src/helper.ts': helper,
        });

        await expect(runBuild({ cwd: root })).rejects.toMatchObject({ code: 'BUILD_VALIDATION_FAILED' });
    });

    it('reports compile errors and missing configuration', async () => {
        const broken = await project({ 'nestrum.config.ts': "import './missing';\nexport default {};\n" });
        await expect(runBuild({ cwd: broken })).rejects.toMatchObject({ code: 'BUILD_BUNDLE_FAILED' });
        const empty = await project({});
        await expect(runBuild({ cwd: empty })).rejects.toMatchObject({ code: 'CLI_CONFIG_NOT_FOUND' });
    });

    it('rejects a tampered or incompatible build', async () => {
        const root = await project({ 'nestrum.config.ts': valid, 'src/helper.ts': helper });
        const { manifest, directory } = await runBuild({ cwd: root });
        await expect(readManifest(root, '9.9.9')).rejects.toMatchObject({ code: 'BUILD_INCOMPATIBLE' });
        await writeFile(join(directory, 'server/index.mjs'), '// tampered\n');
        await expect(readManifest(root, manifest.nestrumVersion)).rejects.toMatchObject({ code: 'BUILD_STALE' });
    });
});
