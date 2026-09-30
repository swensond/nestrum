import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ServerHandle } from '@nestrum/runtime';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { nodeRuntime } from '../src/index.js';

const handles: ServerHandle[] = [];
async function serve(fetch: (request: Request) => Response | Promise<Response>, port = 0, host = '127.0.0.1') {
    const handle = await nodeRuntime.serve({ fetch }, { host, port });
    handles.push(handle);

    return handle;
}
afterEach(async () => {
    await Promise.all(handles.splice(0).map((handle) => handle.close()));
});

describe('nodeRuntime', () => {
    it('serves a Hono application over real HTTP', async () => {
        const app = new Hono();
        app.get('/hello/:name', (context) => context.json({ hello: context.req.param('name') }, 201));
        app.post('/echo', async (context) => context.text(await context.req.text()));
        const handle = await serve((request) => app.fetch(request));

        expect(handle.host).toBe('127.0.0.1');
        expect(handle.port).toBeGreaterThan(0);
        const base = `http://127.0.0.1:${handle.port}`;
        const hello = await fetch(`${base}/hello/nestrum`);
        expect(hello.status).toBe(201);
        expect(await hello.json()).toEqual({ hello: 'nestrum' });
        expect(await (await fetch(`${base}/echo`, { method: 'POST', body: 'ping' })).text()).toBe('ping');
        expect((await fetch(`${base}/missing`)).status).toBe(404);
    });

    it('sends exactly one content-length for responses that set their own', async () => {
        const body = 'héllo';
        const handle = await serve(
            () =>
                new Response(body, {
                    headers: { 'content-length': String(Buffer.byteLength(body)), 'content-type': 'text/plain' },
                }),
        );

        const response = await fetch(`http://127.0.0.1:${handle.port}/`);
        expect(await response.text()).toBe(body);
    });

    it('binds the requested port', async () => {
        const probe = await serve(() => new Response('probe'));
        const port = probe.port;
        await probe.close();
        const handle = await serve(() => new Response('fixed'), port);

        expect(handle.port).toBe(port);
        expect(await (await fetch(`http://127.0.0.1:${port}`)).text()).toBe('fixed');
    });

    it('rejects bind failures without leaving a listener', async () => {
        const occupied = await serve(() => new Response('a'));

        await expect(
            nodeRuntime.serve({ fetch: () => new Response('b') }, { host: '127.0.0.1', port: occupied.port }),
        ).rejects.toMatchObject({ code: 'EADDRINUSE' });
        expect(await (await fetch(`http://127.0.0.1:${occupied.port}`)).text()).toBe('a');
    });

    it('rejects invalid options', async () => {
        const application = { fetch: () => new Response() };

        await expect(nodeRuntime.serve(application, { host: '', port: 0 })).rejects.toThrow(TypeError);
        await expect(nodeRuntime.serve(application, { host: '127.0.0.1', port: 70000 })).rejects.toThrow(RangeError);
        await expect(nodeRuntime.serve(application, { host: '127.0.0.1', port: 1.5 })).rejects.toThrow(RangeError);
    });

    it('stops accepting new connections but finishes in-flight requests before close resolves', async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        let started!: () => void;
        const arrived = new Promise<void>((resolve) => {
            started = resolve;
        });
        const handle = await serve(async () => {
            started();
            await gate;

            return new Response('slow done');
        });
        const url = `http://127.0.0.1:${handle.port}`;
        const pending = fetch(url);
        await arrived;

        await handle.stopAccepting();
        await expect(fetch(url)).rejects.toThrow();
        let closed = false;
        const closing = handle.close().then(() => {
            closed = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(closed).toBe(false);

        release();
        expect(await (await pending).text()).toBe('slow done');
        await closing;
        expect(closed).toBe(true);
    });

    it('is idempotent and releases the port', async () => {
        const handle = await serve(() => new Response('x'));
        const { port } = handle;

        await Promise.all([handle.close(), handle.close(), handle.stopAccepting()]);
        await handle.close();
        const probe = createServer();
        await new Promise<void>((resolve, reject) => {
            probe.once('error', reject);
            probe.listen(port, '127.0.0.1', resolve);
        });
        expect((probe.address() as AddressInfo).port).toBe(port);
        await new Promise((resolve) => probe.close(resolve));
    });
});

describe('@nestrum/runtime-node boundaries', () => {
    it('keeps the portable runtime package Node-free', () => {
        const source = readFileSync(new URL('../../runtime/src/runtime.types.ts', import.meta.url), 'utf8');
        expect(source).not.toMatch(/node:/);
    });
});
