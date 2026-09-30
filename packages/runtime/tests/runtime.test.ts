import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RuntimeAdapter, ServableApplication, ServeOptions, ServerHandle } from '../src/index.js';

/** In-memory adapter that "serves" by dispatching requests straight to the application. */
class FakeAdapter implements RuntimeAdapter {
    readonly events: string[] = [];
    request: ((request: Request) => Promise<Response>) | undefined;

    async serve(application: ServableApplication, options: ServeOptions): Promise<ServerHandle> {
        if (options.port < 0) {
            throw new Error('invalid port');
        }
        const port = options.port === 0 ? 49152 : options.port;
        let accepting = true;
        let closed: Promise<void> | undefined;
        this.request = async (request) =>
            accepting ? await application.fetch(request) : new Response(null, { status: 503 });
        this.events.push(`listen ${options.host}:${port}`);
        const stopAccepting = async () => {
            if (accepting) {
                accepting = false;
                this.events.push('stop');
            }
        };

        return {
            host: options.host,
            port,
            stopAccepting,
            close: () => {
                closed ??= stopAccepting().then(() => {
                    this.events.push('close');
                });

                return closed;
            },
        };
    }
}

const application: ServableApplication = { fetch: () => new Response('ok') };

describe('RuntimeAdapter contract', () => {
    it('serves the application and reports the bound address', async () => {
        const adapter = new FakeAdapter();
        const handle = await adapter.serve(application, { host: '127.0.0.1', port: 0 });

        expect(handle).toMatchObject({ host: '127.0.0.1', port: 49152 });
        expect(await (await adapter.request?.(new Request('http://x/')))?.text()).toBe('ok');
        await handle.close();
    });

    it('stops accepting traffic before final close, idempotently', async () => {
        const adapter = new FakeAdapter();
        const handle = await adapter.serve(application, { host: 'localhost', port: 3000 });

        await handle.stopAccepting();
        await handle.stopAccepting();
        expect((await adapter.request?.(new Request('http://x/')))?.status).toBe(503);
        await Promise.all([handle.close(), handle.close()]);
        await handle.close();
        expect(adapter.events).toEqual(['listen localhost:3000', 'stop', 'close']);
    });

    it('rejects startup failures without leaving a listener', async () => {
        const adapter = new FakeAdapter();

        await expect(adapter.serve(application, { host: 'localhost', port: -1 })).rejects.toThrow('invalid port');
        expect(adapter.events).toEqual([]);
    });

    it('accepts an application with a structurally compatible async fetch', async () => {
        const adapter = new FakeAdapter();
        const handle = await adapter.serve(
            { fetch: async (request) => Response.json({ url: request.url }) },
            { host: 'localhost', port: 1 },
        );

        expect(await (await adapter.request?.(new Request('http://x/a')))?.json()).toEqual({ url: 'http://x/a' });
        await handle.close();
    });
});

describe('@nestrum/runtime portability', () => {
    it('imports no Node built-ins or dependencies', () => {
        const directory = join(import.meta.dirname, '../src');
        for (const file of readdirSync(directory)) {
            expect(readFileSync(join(directory, file), 'utf8')).not.toMatch(/from\s+['"](?:node:|[^.'"])/);
        }
        const manifest = JSON.parse(readFileSync(join(directory, '../package.json'), 'utf8')) as Record<
            string,
            unknown
        >;
        expect(manifest.dependencies).toBeUndefined();
    });
});
