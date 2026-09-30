import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DevSession } from '../src/index.js';
import {
    adminSecurityDiagnostics,
    classifyChange,
    featureDiagnostics,
    parseRuntimeArguments,
    runDev,
} from '../src/index.js';

const roots: string[] = [];
const sessions: DevSession[] = [];

const config = (root: string, port: number) => `import { defineApplication, defineResource } from '@nestrum/core';
import { defineConfig } from '@nestrum/cli';
import { readFileSync } from 'node:fs';
import { generateModelSchemas } from '@nestrum/zod';
import { list } from './src/flags';
export default defineConfig({
    server: { port: ${port} },
    application: defineApplication({
        databases: { default: { kind: 'prisma', provider: 'postgresql', connection: 'postgresql://u:p@127.0.0.1:1/x' } },
        apps: [{ name: 'models', prisma: { default: ['./models.prisma'] }, resources: [defineResource({ model: 'Project', api: { list } })] }],
        resourceModels: () => JSON.parse(readFileSync(${JSON.stringify(join(root, '.nestrum/dev/generated/models/default.json'))}, 'utf8')).map(generateModelSchemas),
    }),
    timeoutMs: 60000
});
`;
const MODEL = (extra = '') => `model Project {\n id Int @id\n name String\n${extra}}\n`;

async function scaffold(port = 0) {
    const root = await mkdtemp(join(import.meta.dirname, '..', '.tmp-dev-'));
    roots.push(root);
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'nestrum.config.ts'), config(root, port));
    await writeFile(join(root, 'src/flags.ts'), 'export const list = true;\n');
    await writeFile(join(root, 'models.prisma'), MODEL());

    return root;
}
async function start(root: string) {
    const lines: string[] = [];
    const session = await runDev({ cwd: root, env: {}, log: (line) => lines.push(line), watch: false, debounceMs: 5 });
    sessions.push(session);

    return { session, lines };
}
const paths = async (session: DevSession) =>
    Object.keys((await (await fetch(`${session.url()}/api/openapi.json`)).json()).paths ?? {});

afterEach(async () => {
    await Promise.all(sessions.splice(0).map((session) => session.close()));
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('adminSecurityDiagnostics', () => {
    it('reports required 2FA, warns on explicit opt-out and stays silent without an admin', () => {
        expect(adminSecurityDiagnostics({ twoFactor: { required: true } }).join('\n')).toContain(
            'Admin security\n  2FA required    yes',
        );
        const disabled = adminSecurityDiagnostics({ twoFactor: { required: false } }).join('\n');
        expect(disabled).toContain('2FA required    no');
        expect(disabled).toContain('WARNING\nAdmin 2FA is disabled for this application.');
        expect(adminSecurityDiagnostics(undefined)).toEqual([]);
    });
});

describe('classifyChange', () => {
    it('classifies sources and ignores generated output', () => {
        expect(classifyChange('/p', '/p/nestrum.config.ts')).toBe('config');
        expect(classifyChange('/p', '/p/src/nestrum.config.ts')).toBe('app');
        expect(classifyChange('/p', '/p/src/a.ts')).toBe('app');
        expect(classifyChange('/p', '/p/models.prisma')).toBe('prisma');
        expect(classifyChange('/p', '/p/src/Widget.svelte')).toBe('frontend');
        expect(classifyChange('/p', '/p/.nestrum/dev/server-1.mjs')).toBeUndefined();
        expect(classifyChange('/p', '/p/node_modules/x/index.js')).toBeUndefined();
        expect(classifyChange('/p', '/p/README.md')).toBeUndefined();
        expect(classifyChange('/p', '/other/a.ts')).toBeUndefined();
    });
});

describe('nestrum dev', () => {
    it('starts from one call and reports framework diagnostics', async () => {
        const { session, lines } = await start(await scaffold());

        expect(session.url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
        expect(await paths(session)).toEqual(expect.arrayContaining([expect.stringContaining('project')]));
        const banner = lines.join('\n');
        expect(banner).toContain('(development)');
        expect(banner).toMatch(/Apps\s+1/);
        expect(banner).toContain('/api/openapi.json');
        expect(banner).toContain('Watching for changes...');
    });

    it('restarts on application source changes and picks up new behavior', async () => {
        const root = await scaffold();
        const { session, lines } = await start(root);
        expect((await paths(session)).length).toBeGreaterThan(0);

        await writeFile(join(root, 'src/flags.ts'), 'export const list = false;\n');
        session.changed(join(root, 'src/flags.ts'));
        await session.idle();

        expect(await paths(session)).toEqual([]);
        expect(lines.some((line) => line.includes('Change detected (app)'))).toBe(true);
        expect(lines.some((line) => line.includes('may require migration'))).toBe(false);
        expect(await readdir(join(root, '.nestrum/dev'))).toEqual(expect.arrayContaining(['generated', 'contracts']));
    });

    it('regenerates on Prisma changes, reports migration guidance, and never migrates', async () => {
        const root = await scaffold();
        const { session, lines } = await start(root);

        await writeFile(join(root, 'models.prisma'), MODEL(' note String?\n'));
        session.changed(join(root, 'models.prisma'));
        await session.idle();

        const output = lines.join('\n');
        expect(output).toContain('Database "default" may require migration.');
        expect(output).toContain('nestrum db migrate --database default');
        expect(session.url()).toBeDefined();
    });

    it('restarts fully on configuration changes', async () => {
        const root = await scaffold();
        const { session } = await start(root);
        const before = session.url();

        await writeFile(
            join(root, 'nestrum.config.ts'),
            config(root, 0).replace('port: 0', 'host: "localhost", port: 0'),
        );
        session.changed(join(root, 'nestrum.config.ts'));
        await session.idle();

        expect(before).toBeDefined();
        expect(session.url()).toMatch(/^http:\/\/localhost:\d+$/);
    });

    it('reports errors with framework identity and recovers on the next edit', async () => {
        const root = await scaffold();
        const { session, lines } = await start(root);

        await writeFile(join(root, 'src/flags.ts'), 'export const list = ;\n');
        session.changed(join(root, 'src/flags.ts'));
        await session.idle();
        expect(session.url()).toBeUndefined();
        expect(lines.join('\n')).toContain('BUILD_BUNDLE_FAILED');

        await writeFile(join(root, 'src/flags.ts'), 'export const list = true;\n');
        session.changed(join(root, 'src/flags.ts'));
        await session.idle();
        expect(session.url()).toBeDefined();
        expect((await paths(session)).length).toBeGreaterThan(0);
    });

    it('coalesces bursts of edits and ignores generated output', async () => {
        const root = await scaffold();
        const { session, lines } = await start(root);

        for (let index = 0; index < 5; index++) {
            session.changed(join(root, 'src/flags.ts'));
        }
        session.changed(join(root, '.nestrum/dev/server-1.mjs'));
        await session.idle();

        expect(lines.filter((line) => line.startsWith('Change detected'))).toHaveLength(1);
    });

    it('restarts from real filesystem events', async () => {
        const root = await scaffold();
        const lines: string[] = [];
        const session = await runDev({ cwd: root, env: {}, log: (line) => lines.push(line), debounceMs: 50 });
        sessions.push(session);

        await writeFile(join(root, 'src/flags.ts'), 'export const list = false;\n');
        for (let attempt = 0; attempt < 100; attempt++) {
            if (lines.filter((line) => line.includes('Watching')).length > 1) {
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        await session.idle();

        expect(await paths(session)).toEqual([]);
    });

    it('refuses a conflicting NESTRUM_ENV', async () => {
        const root = await scaffold();

        await expect(runDev({ cwd: root, env: { NESTRUM_ENV: 'production' }, watch: false })).rejects.toMatchObject({
            code: 'CLI_ENVIRONMENT_CONFLICT',
        });
    });

    it('proxies the consumer Vite server behind the backend without restarting it for frontend edits', async () => {
        const root = await scaffold();
        await writeFile(
            join(root, 'nestrum.config.ts'),
            config(root, 0).replace(
                'timeoutMs: 60000',
                "web: { enabled: true, root: './web', publicEnv: { site: 'dev' } },\n    timeoutMs: 60000",
            ),
        );
        await mkdir(join(root, 'web'), { recursive: true });
        await writeFile(
            join(root, 'web/index.html'),
            '<!doctype html><html><head></head><body><script type="module" src="/main.js"></script></body></html>',
        );
        await writeFile(join(root, 'web/main.js'), 'export const v = 1;');
        const { session, lines } = await start(root);
        const url = session.url();

        expect(lines.join('\n')).toContain(`Web        ${url}/`);
        const page = await (await fetch(`${url}/dashboard`)).text();
        expect(page).toContain('/main.js');
        expect(page).toContain('"site":"dev"');
        expect(await (await fetch(`${url}/main.js`)).text()).toContain('v = 1');
        expect((await fetch(`${url}/api/nope`, { headers: { accept: 'text/html' } })).status).toBe(404);
        expect((await fetch(`${url}/__admin/nope`)).status).toBe(404);
        const before = lines.length;
        await writeFile(join(root, 'web/main.js'), 'export const v = 2;');
        session.changed(join(root, 'web/main.js'));
        await session.idle();
        expect(lines.length).toBe(before);
        expect(session.url()).toBe(url);
        expect(await (await fetch(`${url}/main.js`)).text()).toContain('v = 2');
        await session.close();
        await expect(fetch(`${url}/`)).rejects.toThrow();
    });

    it('renders server-side through Vite under a base path and applies SSR edits without a backend restart', async () => {
        const root = await scaffold();
        await writeFile(
            join(root, 'nestrum.config.ts'),
            config(root, 0).replace(
                'timeoutMs: 60000',
                "web: { enabled: true, root: './web', basePath: '/app', ssr: { entry: './entry-server.js' } },\n    timeoutMs: 60000",
            ),
        );
        await mkdir(join(root, 'web'), { recursive: true });
        await writeFile(
            join(root, 'web/index.html'),
            '<!doctype html><html><head></head><body><div id="app"><!--ssr-outlet--></div><script type="module" src="/app/main.js"></script></body></html>',
        );
        await writeFile(join(root, 'web/main.js'), 'export const v = 1;');
        const entry = (label: string) =>
            `export function render(request, { template }) { return new Response(template.replace('<!--ssr-outlet-->', '${label} ' + new URL(request.url).pathname), { headers: { 'content-type': 'text/html' } }); }`;
        await writeFile(join(root, 'web/entry-server.js'), entry('one'));
        const { session, lines } = await start(root);
        const url = session.url();

        expect(lines.join('\n')).toContain(`Web        ${url}/app/  (SSR)`);
        const page = await (await fetch(`${url}/app/deep/link`)).text();
        expect(page).toContain('one /app/deep/link');
        expect(page).toContain('/@vite/client');
        expect(await (await fetch(`${url}/app/main.js`)).text()).toContain('v = 1');
        expect((await fetch(`${url}/`)).status).toBe(404);
        expect((await fetch(`${url}/api/nope`, { headers: { accept: 'text/html' } })).status).toBe(404);
        const before = lines.length;
        await writeFile(join(root, 'web/entry-server.js'), entry('two'));
        session.changed(join(root, 'web/entry-server.js'));
        await session.idle();
        expect(lines.length).toBe(before);
        expect(await (await fetch(`${url}/app/deep/link`)).text()).toContain('two /app/deep/link');
    });
});

describe('nestrum dev --feature', () => {
    it('parses repeatable name=boolean overrides for dev only', () => {
        expect(
            parseRuntimeArguments(['dev', '--feature', 'newDashboard=true', '--feature', 'beta=false']).features,
        ).toEqual({
            newDashboard: true,
            beta: false,
        });
        expect(parseRuntimeArguments(['dev']).features).toBeUndefined();
        for (const bad of [
            ['dev', '--feature', 'newDashboard'],
            ['dev', '--feature', 'NewDashboard=true'],
            ['dev', '--feature', 'a=yes'],
            ['dev', '--feature', 'a=true', '--feature', 'a=false'],
            ['dev', '--feature'],
            ['serve', '--feature', 'a=true'],
            ['build', '--feature', 'a=true'],
        ]) {
            expect(() => parseRuntimeArguments(bad), bad.join(' ')).toThrowError(
                expect.objectContaining({ code: 'CLI_ARGUMENT_INVALID' }),
            );
        }
        expect(() => parseRuntimeArguments(['dev', '--port', '1', '--port', '2'])).toThrow(/repeated/);
    });

    it('lists overrides in the banner and stays silent without them', () => {
        expect(featureDiagnostics(undefined)).toEqual([]);
        expect(featureDiagnostics({}).length).toBe(0);
        expect(featureDiagnostics({ newDashboard: true }).join('\n')).toContain('newDashboard=true');
    });

    it('applies overrides to this process only, without persisting, and restores the environment', async () => {
        const root = await mkdtemp(join(import.meta.dirname, '..', '.tmp-dev-'));
        roots.push(root);
        await writeFile(join(root, 'models.prisma'), MODEL());
        await writeFile(
            join(root, 'nestrum.config.ts'),
            `import { defineApplication, defineFeatureFlags } from '@nestrum/core';
import { defineConfig } from '@nestrum/cli';
import { defineFeatures } from '@nestrum/features';
export const flags = defineFeatureFlags({ newDashboard: { default: false, exposeToClient: true }, beta: { default: false, exposeToClient: true } });
export default defineConfig({
    server: { port: 0 },
    application: defineApplication({
        databases: { default: { kind: 'prisma', provider: 'postgresql', connection: 'postgresql://u:p@127.0.0.1:1/x' } },
        apps: [{ name: 'models', prisma: { default: ['./models.prisma'] } }],
        features: defineFeatures({ flags }),
    }),
    timeoutMs: 60000
});
`,
        );
        const before = { env: process.env.NESTRUM_ENV, features: process.env.NESTRUM_DEV_FEATURES };
        const lines: string[] = [];
        const session = await runDev({
            cwd: root,
            env: {},
            log: (line) => lines.push(line),
            watch: false,
            features: { newDashboard: true },
        });
        sessions.push(session);
        const served = (await (await fetch(`${session.url()}/__nestrum/features`)).json()) as {
            features: Record<string, boolean>;
        };
        expect(served.features).toEqual({ newDashboard: true, beta: false });
        expect(lines.join('\n')).toContain('Feature overrides (this process only; storage is unchanged)');
        await session.close();
        expect(process.env.NESTRUM_ENV).toBe(before.env);
        expect(process.env.NESTRUM_DEV_FEATURES).toBe(before.features);
    }, 60_000);
});
