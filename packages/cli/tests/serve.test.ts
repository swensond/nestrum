import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import type { RuntimeAdapter } from '@nestrum/runtime';
import { nodeRuntime } from '@nestrum/runtime-node';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunningServer } from '../src/index.js';
import { establishEnvironment, resolveServerOptions, runBuild, runServe } from '../src/index.js';

const roots: string[] = [];
const servers: RunningServer[] = [];

async function project(source: string): Promise<string> {
    const root = await mkdtemp(join(import.meta.dirname, '..', '.tmp-serve-'));
    roots.push(root);
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'nestrum.config.ts'), source);

    return root;
}
afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.shutdown()));
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const PRISMA = JSON.stringify('model Project {\n id Int @id\n name String\n}\n');
const application = (extra = '', server = '') => `import { defineApplication, defineResource } from '@nestrum/core';
import { defineConfig } from '@nestrum/cli';
import { readFileSync } from 'node:fs';
import { generateModelSchemas } from '@nestrum/zod';
const events = ((globalThis as any).__nestrumEvents ??= [] as string[]);
export default defineConfig({
    application: defineApplication({
        databases: { default: { kind: 'prisma', provider: 'postgresql', connection: 'postgresql://u:p@127.0.0.1:1/x' } },
        apps: [{
            name: 'models',
            prismaSource: { default: ${PRISMA} },
            resources: [defineResource({ model: 'Project', api: { list: true } })],
            configure: () => { events.push('configure'); },
            ${extra}
        }],
        // Models come from the build's metadata artifact: serving performs no generation.
        resourceModels: () => JSON.parse(readFileSync(new URL('../generated/models/default.json', import.meta.url), 'utf8')).map(generateModelSchemas),
    }),
    ${server}
    timeoutMs: 60000
});
`;
const env = () => ({}) as Record<string, string | undefined>;

async function freePort(): Promise<number> {
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const port = (probe.address() as { port: number }).port;
    await new Promise((resolve) => probe.close(resolve));

    return port;
}

describe('nestrum serve', () => {
    it('serves a built application without a user bootstrap and shuts down in order', async () => {
        const root = await project(application('', 'server: { port: 1, host: "0.0.0.0" },'));
        await runBuild({ cwd: root });
        (globalThis as { __nestrumEvents?: string[] }).__nestrumEvents = [];
        const port = await freePort();
        const variables = env();
        const server = await runServe({ cwd: root, flags: { port }, env: variables });
        servers.push(server);

        expect(variables.NESTRUM_ENV).toBe('production');
        expect(server).toMatchObject({ host: '0.0.0.0', port });
        expect((globalThis as { __nestrumEvents?: string[] }).__nestrumEvents).toContain('configure');
        const document = await (await fetch(`http://127.0.0.1:${port}/api/openapi.json`)).json();
        expect(Object.keys(document.paths).some((path) => path.includes('project'))).toBe(true);
        expect((await fetch(`http://127.0.0.1:${port}/nope`)).status).toBe(404);
        await server.shutdown();
        await server.shutdown();
        expect(server.runtime.state).toBe('stopped');
        await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
    });

    it('fails with build guidance when there is no build, and never builds', async () => {
        const root = await project(application());

        await expect(runServe({ cwd: root, env: env() })).rejects.toMatchObject({
            code: 'BUILD_NOT_FOUND',
            message: expect.stringContaining('nestrum build'),
        });
        await expect(runBuild({ cwd: root }).then(() => 'built')).resolves.toBe('built');
    });

    it('does not bind a listener when startup fails and rolls back', async () => {
        const root = await project(application("ready: () => { throw new Error('boom'); },"));
        await runBuild({ cwd: root });
        const port = await freePort();

        await expect(runServe({ cwd: root, flags: { port }, env: env() })).rejects.toThrow();
        const probe = createServer();
        await new Promise<void>((resolve, reject) => {
            probe.once('error', reject);
            probe.listen(port, '127.0.0.1', resolve);
        });
        await new Promise((resolve) => probe.close(resolve));
    });

    it('rejects a conflicting NESTRUM_ENV', async () => {
        const root = await project(application());
        await runBuild({ cwd: root });

        await expect(runServe({ cwd: root, env: { NESTRUM_ENV: 'development' } })).rejects.toMatchObject({
            code: 'CLI_ENVIRONMENT_CONFLICT',
        });
    });
});

describe('lifecycle hardening', () => {
    /** Captures the served application and adds a slow route so an in-flight request can span shutdown. */
    function slowAdapter(gate: Promise<void>, arrived: () => void) {
        const captured: { served?: { fetch(request: Request): Response | Promise<Response> } } = {};
        const adapter: RuntimeAdapter = {
            serve: (application, options) => {
                captured.served = application;

                return nodeRuntime.serve(
                    {
                        fetch: async (request) => {
                            if (new URL(request.url).pathname === '/slow') {
                                arrived();
                                await gate;

                                return new Response('finished');
                            }

                            return application.fetch(request);
                        },
                    },
                    options,
                );
            },
        };

        return { adapter, captured };
    }

    it('reports health and readiness, drops readiness first on shutdown, and lets in-flight requests finish', async () => {
        const root = await project(application());
        await runBuild({ cwd: root });
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        let arrive!: () => void;
        const arrived = new Promise<void>((resolve) => {
            arrive = resolve;
        });
        const { adapter, captured } = slowAdapter(gate, arrive);
        const port = await freePort();
        const server = await runServe({ cwd: root, flags: { port }, env: env(), adapter });
        servers.push(server);
        const probe = (path: string) => captured.served?.fetch(new Request(`http://x${path}`, { method: 'GET' }));

        const health = await fetch(`http://127.0.0.1:${port}/__nestrum/health`);
        expect(health.status).toBe(200);
        expect(await health.json()).toEqual({ status: 'ok' });
        expect(await (await fetch(`http://127.0.0.1:${port}/__nestrum/ready`)).json()).toEqual({ status: 'ready' });
        expect((await fetch(`http://127.0.0.1:${port}/__nestrum/ready`, { method: 'POST' })).status).toBe(405);

        const pending = fetch(`http://127.0.0.1:${port}/slow`);
        await arrived;
        let done = false;
        const closing = server.shutdown().then(() => {
            done = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect((await probe('/__nestrum/ready'))?.status).toBe(503);
        expect((await probe('/__nestrum/health'))?.status).toBe(200);
        expect(done).toBe(false);
        release();
        expect(await (await pending).text()).toBe('finished');
        await closing;
        expect(server.runtime.state).toBe('stopped');
    });

    it('runs shutdown hooks of already-configured apps when startup fails', async () => {
        const root = await project(
            application("ready: () => { throw new Error('boom'); }, shutdown: () => { events.push('shutdown'); },"),
        );
        await runBuild({ cwd: root });
        (globalThis as { __nestrumEvents?: string[] }).__nestrumEvents = [];

        await expect(runServe({ cwd: root, flags: { port: await freePort() }, env: env() })).rejects.toThrow();
        expect((globalThis as { __nestrumEvents?: string[] }).__nestrumEvents).toEqual(['configure', 'shutdown']);
    });

    it('fails shutdown at the drain deadline and leaves resources open for the caller to force-exit', async () => {
        const root = await project(application('', 'server: { drainTimeoutMs: 100 },'));
        await runBuild({ cwd: root });
        const gate = new Promise<void>(() => undefined);
        let arrive!: () => void;
        const arrived = new Promise<void>((resolve) => {
            arrive = resolve;
        });
        // The slow request must be counted by the Hono runtime, so route it through the runtime's pipeline.
        const captured: { fetch?: (request: Request) => Response | Promise<Response> } = {};
        const adapter: RuntimeAdapter = {
            serve: (served, options) => {
                captured.fetch = served.fetch;

                return nodeRuntime.serve(served, options);
            },
        };
        const server = await runServe({ cwd: root, flags: { port: await freePort() }, env: env(), adapter });
        servers.push(server);
        server.runtime.hono.get('/hang', async () => {
            arrive();
            await gate;

            return new Response('never');
        });
        const port = server.port;
        void fetch(`http://127.0.0.1:${port}/hang`).catch(() => undefined);
        await arrived;

        await expect(server.shutdown()).rejects.toMatchObject({ code: 'HTTP_RUNTIME_DRAIN_TIMEOUT' });
        expect(server.runtime.state).toBe('failed');
        servers.pop();
    });
});

describe('option resolution', () => {
    it('applies flag, environment, configuration, then default precedence', () => {
        const config = { host: 'config-host', port: 3000 };
        expect(resolveServerOptions({ flags: { port: 8080 }, env: { PORT: '4000' }, config })).toEqual({
            host: 'config-host',
            port: 8080,
        });
        expect(resolveServerOptions({ env: { PORT: '4000', HOST: 'env-host' }, config })).toEqual({
            host: 'env-host',
            port: 4000,
        });
        expect(resolveServerOptions({ env: {}, config })).toEqual(config);
        expect(resolveServerOptions({ env: {} })).toEqual({ host: '127.0.0.1', port: 3000 });
        expect(() => resolveServerOptions({ env: { PORT: 'abc' } })).toThrow('PORT');
        expect(() => resolveServerOptions({ env: { PORT: '70000' } })).toThrow('PORT');
    });

    it('establishes the requested environment', () => {
        const env: Record<string, string | undefined> = {};
        expect(establishEnvironment('development', env)).toBe('development');
        expect(env.NESTRUM_ENV).toBe('development');
        expect(() => establishEnvironment('production', env)).toThrow('conflicts');
    });
});
