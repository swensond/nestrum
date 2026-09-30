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

        expect(manifest.web).toEqual({ directory: 'web', basePath: '' });
        expect(await readFile(join(directory, 'web/index.html'), 'utf8')).toContain('assets/');
        expect((await readdir(join(directory, 'web/assets'))).some((file) => file.endsWith('.js'))).toBe(true);
        expect((await readdir(join(directory, 'web/assets'))).some((file) => file.endsWith('.map'))).toBe(false);
        await expect(readManifest(root, manifest.nestrumVersion)).resolves.toMatchObject({
            web: { directory: 'web', basePath: '' },
        });
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

describe('nestrum build with basePath and SSR', () => {
    const ssrEntry = `export function render(request, { template, basePath, publicEnv }) {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/not-found')) return undefined;
    return new Response(template.replace('<!--ssr-outlet-->', 'rendered ' + path + ' ' + basePath + ' ' + publicEnv.site), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
    });
}
`;
    const ssrPage =
        '<!doctype html><html><head><title>t</title></head><body><div id="app"><!--ssr-outlet--></div><script type="module" src="./main.js"></script></body></html>';
    const files = (web: string) => ({
        'nestrum.config.ts': config(web),
        'web/index.html': ssrPage,
        'web/main.js': "document.title = 'consumer';",
        'web/entry-server.js': ssrEntry,
    });

    it('bundles the SSR entry outside the served directory and records base path and entry', async () => {
        const root = await project(
            files(
                "{ enabled: true, root: './web', basePath: '/app', ssr: { entry: './entry-server.js' }, publicEnv: { site: 's' } }",
            ),
        );
        const { manifest, directory } = await runBuild({ cwd: root });

        expect(manifest.web).toEqual({ directory: 'web', basePath: '/app', ssr: { entry: 'web-server/entry.mjs' } });
        expect(await readFile(join(directory, 'web/index.html'), 'utf8')).toContain('/app/assets/');
        expect(await readFile(join(directory, 'web/index.html'), 'utf8')).toContain('<!--ssr-outlet-->');
        expect(await readFile(join(directory, 'web-server/entry.mjs'), 'utf8')).toContain('ssr-outlet');
        await expect(readdir(join(directory, 'web/web-server'))).rejects.toThrow();
        await expect(readManifest(root, manifest.nestrumVersion)).resolves.toMatchObject({ web: { basePath: '/app' } });
        await rm(join(directory, 'web-server/entry.mjs'));
        await expect(readManifest(root, manifest.nestrumVersion)).rejects.toMatchObject({ code: 'BUILD_INCOMPLETE' });
    });

    it('rejects a reserved base path in config', async () => {
        const root = await project(files("{ enabled: true, root: './web', basePath: '/admin' }"));
        await expect(runBuild({ cwd: root })).rejects.toMatchObject({
            message: expect.stringContaining('reserved framework namespace'),
        });
    });
});
