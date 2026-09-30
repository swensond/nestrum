import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertNoSecretsInOutput, readManifest, runBuild, serverSecrets } from '../src/index.js';

const roots: string[] = [];
const PROJECT = 'model Project {\n id Int @id\n name String\n}\n';

async function project(files: Record<string, string>): Promise<string> {
    const root = await mkdtemp(join(import.meta.dirname, '..', '.tmp-web-'));
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

const config = (web: string) => `import { defineApplication, defineResource } from '@nestrum/core';
import { defineConfig } from '@nestrum/cli';
export default defineConfig({
    application: defineApplication({
        databases: { default: { kind: 'prisma', provider: 'postgresql', connection: 'postgresql://user:secret@127.0.0.1:1/x' } },
        apps: [{ name: 'models', prismaSource: { default: ${JSON.stringify(PROJECT)} }, resources: [defineResource({ model: 'Project' })] }],
    }),
    web: ${web},
    timeoutMs: 60000
});
`;
const page =
    '<!doctype html><html><head><title>t</title></head><body><script type="module" src="./main.js"></script></body></html>';

describe('nestrum build with a consumer UI', () => {
    it('builds the web root into .nestrum/web and records it in the manifest', async () => {
        const root = await project({
            'nestrum.config.ts': config("{ enabled: true, root: './web', publicEnv: { site: 'demo' } }"),
            'web/index.html': page,
            'web/main.js': "document.title = 'consumer';",
        });
        const { manifest, directory } = await runBuild({ cwd: root });

        expect(manifest.web).toEqual({ directory: 'web' });
        expect(await readFile(join(directory, 'web/index.html'), 'utf8')).toContain('assets/');
        expect((await readdir(join(directory, 'web/assets'))).some((file) => file.endsWith('.js'))).toBe(true);
        expect((await readdir(join(directory, 'web/assets'))).some((file) => file.endsWith('.map'))).toBe(false);
        await expect(readManifest(root, manifest.nestrumVersion)).resolves.toMatchObject({ web: { directory: 'web' } });
    });

    it('records no web output when the consumer UI is not enabled', async () => {
        const root = await project({ 'nestrum.config.ts': config('undefined') });
        const { manifest, directory } = await runBuild({ cwd: root });
        expect(manifest.web).toBeNull();
        await expect(readdir(join(directory, 'web'))).rejects.toThrow();
    });

    it('fails on routes that shadow framework namespaces, naming the file and namespace', async () => {
        const root = await project({
            'nestrum.config.ts': config("{ enabled: true, root: './web' }"),
            'web/index.html': page,
            'web/main.js': '',
            'web/src/routes/admin/page.txt': 'x',
        });
        await expect(runBuild({ cwd: root })).rejects.toMatchObject({
            code: 'BUILD_WEB_COLLISION',
            message: expect.stringContaining('src/routes/admin shadows the framework namespace "/admin"'),
        });
    });

    it('fails when the web root has no index.html', async () => {
        const root = await project({ 'nestrum.config.ts': config("{ enabled: true, root: './web' }") });
        await expect(runBuild({ cwd: root })).rejects.toMatchObject({ code: 'BUILD_WEB_FAILED' });
    });

    it('fails the build when a server secret is bundled into the browser output', async () => {
        const root = await project({
            'nestrum.config.ts': config("{ enabled: true, root: './web' }"),
            'web/index.html': page,
            'web/main.js': "document.title = 'leaky-secret-value-123';",
        });
        process.env.NESTRUM_TEST_AUTH_SECRET = 'leaky-secret-value-123';
        try {
            await expect(runBuild({ cwd: root })).rejects.toMatchObject({ code: 'BUILD_WEB_LEAK' });
        } finally {
            delete process.env.NESTRUM_TEST_AUTH_SECRET;
        }
    });
});

describe('secret detection', () => {
    it('selects secret-named variables and credentialed URLs but not allowlisted public values', async () => {
        const env = {
            AUTH_SECRET: 'super-secret-value',
            SHORT_SECRET: 'x',
            DB: 'postgresql://user:pw@host/db',
            BASE_URL: 'http://127.0.0.1:3100',
            PUBLIC_TOKEN: 'shared-public-token',
        };
        expect(serverSecrets(env, { site: 'shared-public-token' }).sort()).toEqual([
            'postgresql://user:pw@host/db',
            'super-secret-value',
        ]);
        const root = await project({ 'out/a.js': 'clean' });
        await expect(assertNoSecretsInOutput(join(root, 'out'), ['nope-nope'])).resolves.toBe(1);
    });
});
