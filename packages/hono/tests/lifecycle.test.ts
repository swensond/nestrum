import { defineApplication } from '@nestrum/core';
import { describe, expect, it, vi } from 'vitest';
import { createHonoRuntime, createRuntimeContainer } from '../src/index.js';

const DATABASES = { default: { kind: 'prisma', provider: 'postgresql', connection: 'unused' } } as const;

describe('Final HTTP lifecycle ordering', () => {
    it('times out draining without disposing active resources and permits a later safe shutdown retry', async () => {
        let release!: () => void;
        let arrived!: () => void;
        const pending = new Promise<void>((resolve) => {
            release = resolve;
        });
        const entered = new Promise<void>((resolve) => {
            arrived = resolve;
        });
        const disconnect = vi.fn();
        const shutdown = vi.fn();
        const stopTraffic = vi.fn();
        const app = defineApplication({
            apps: [{ name: 'app', shutdown }],
            databases: DATABASES,
            databaseLifecycle: { default: { connect: () => {}, disconnect } },
        });
        const runtime = createHonoRuntime({ application: app, drainTimeoutMs: 5, stopTraffic });
        runtime.hono.get('/', async (context) => {
            arrived();
            await pending;
            return context.text('done');
        });
        await runtime.start();
        const request = runtime.fetch(new Request('http://localhost/'));
        await entered;
        await expect(runtime.shutdown()).rejects.toMatchObject({ code: 'HTTP_RUNTIME_DRAIN_TIMEOUT' });
        expect(shutdown).not.toHaveBeenCalled();
        expect(disconnect).not.toHaveBeenCalled();
        expect((await runtime.fetch(new Request('http://localhost/'))).status).toBe(503);
        release();
        await request;
        await runtime.shutdown();
        expect(shutdown).toHaveBeenCalledOnce();
        expect(disconnect).toHaveBeenCalledOnce();
        expect(stopTraffic).toHaveBeenCalledOnce();
    });
    it('registers routes before ready, stops the host before app cleanup, disposes DI before database disconnect', async () => {
        const events: string[] = [];
        const app = defineApplication({
            apps: [
                {
                    name: 'app',
                    configure: () => {
                        events.push('configure');
                    },
                    ready: () => {
                        expect(runtime.hono.routes.some((route) => route.path === '/api/openapi.json')).toBe(false);
                        expect(runtime.getOpenApiDocument()).toHaveProperty('paths');
                        expect(runtime.state).toBe('starting');
                        events.push('ready');
                    },
                    shutdown: () => {
                        events.push('app');
                    },
                },
            ],
            databases: DATABASES,
            databaseLifecycle: {
                default: {
                    connect: () => {
                        events.push('connect');
                    },
                    disconnect: () => {
                        events.push('database');
                    },
                },
            },
        });
        const root = createRuntimeContainer(app);
        const runtime = createHonoRuntime({
            application: app,
            stopTraffic: async () => {
                expect((await runtime.fetch(new Request('http://localhost/'))).status).toBe(503);
                events.push('stop');
            },
            di: {
                container: root,
                createScope: (inputs) => root.createScope(inputs),
                dispose: async () => {
                    events.push('di');
                    await root.dispose();
                },
            },
        });
        await runtime.start();
        await runtime.shutdown();
        await runtime.shutdown();
        expect(events).toEqual(['connect', 'configure', 'ready', 'stop', 'app', 'di', 'database']);
    });
    it('continues cleanup after host/app/DI failures and disconnects only once', async () => {
        const events: string[] = [];
        const app = defineApplication({
            apps: [
                {
                    name: 'app',
                    shutdown: () => {
                        events.push('app');
                        throw new Error('app');
                    },
                },
            ],
            databases: DATABASES,
            databaseLifecycle: {
                default: {
                    connect: () => {},
                    disconnect: () => {
                        events.push('database');
                    },
                },
            },
        });
        const root = createRuntimeContainer(app);
        const runtime = createHonoRuntime({
            application: app,
            stopTraffic: () => {
                events.push('stop');
                throw new Error('host');
            },
            di: {
                container: root,
                createScope: (inputs) => root.createScope(inputs),
                dispose: () => {
                    events.push('di');
                    throw new Error('di');
                },
            },
        });
        await runtime.start();
        await expect(runtime.shutdown()).rejects.toMatchObject({
            code: 'HTTP_RUNTIME_SHUTDOWN_FAILED',
            cause: expect.any(AggregateError),
        });
        expect(events).toEqual(['stop', 'app', 'di', 'database']);
        await runtime.shutdown();
        expect(events).toHaveLength(4);
        await root.dispose();
    });
    it('disposes DI before disconnecting databases when pre-ready route registration fails', async () => {
        const events: string[] = [];
        const ready = vi.fn();
        const app = defineApplication({
            apps: [
                {
                    name: 'app',
                    ready,
                    shutdown: () => {
                        events.push('app');
                    },
                },
            ],
            databases: DATABASES,
            databaseLifecycle: {
                default: {
                    connect: () => {},
                    disconnect: () => {
                        events.push('database');
                    },
                },
            },
        });
        const root = createRuntimeContainer(app);
        const runtime = createHonoRuntime({
            application: app,
            adminUi: { basePath: '/admin', handle: async () => new Response() },
            di: {
                container: root,
                createScope: (inputs) => root.createScope(inputs),
                dispose: async () => {
                    events.push('di');
                    await root.dispose();
                },
            },
        });
        await expect(runtime.start()).rejects.toMatchObject({ code: 'ADMIN_UI_CONFIG_INVALID' });
        expect(ready).not.toHaveBeenCalled();
        expect(events).toEqual(['app', 'di', 'database']);
        await runtime.shutdown();
        expect(events).toHaveLength(3);
    });
});
