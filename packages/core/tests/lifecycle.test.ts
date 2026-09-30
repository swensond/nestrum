import { describe, expect, it, vi } from 'vitest';
import { defineApplication } from '../src/index.js';

const DATABASE = { kind: 'prisma', provider: 'postgresql', connection: 'unused' } as const;

describe('Managed lifecycle barriers', () => {
    it('prepares, connects, validates models, configures, registers routes, readies, then cleans up in order', async () => {
        const events: string[] = [];
        const record = (event: string) => () => {
            events.push(event);
        };
        const application = defineApplication({
            apps: [
                {
                    name: 'child',
                    dependsOn: ['parent'],
                    configure: record('configure:child'),
                    ready: record('ready:child'),
                    shutdown: record('shutdown:child'),
                },
                {
                    name: 'parent',
                    configure: record('configure:parent'),
                    ready: record('ready:parent'),
                    shutdown: record('shutdown:parent'),
                },
            ],
            database: DATABASE,
            prepare: record('prepare'),
            databaseLifecycle: { connect: record('connect'), disconnect: record('disconnect') },
            resourceModels: () => {
                events.push('models');
                return [];
            },
        });
        await application.start({ beforeReady: record('routes'), afterApps: record('di') });
        await application.shutdown();
        await application.shutdown();
        expect(events).toEqual([
            'prepare',
            'connect',
            'models',
            'configure:parent',
            'configure:child',
            'routes',
            'ready:parent',
            'ready:child',
            'shutdown:child',
            'shutdown:parent',
            'di',
            'disconnect',
        ]);
    });
    it('disconnects a database whose connection failed, following DI cleanup', async () => {
        const events: string[] = [];
        const configure = vi.fn();
        const application = defineApplication({
            apps: [{ name: 'app', configure }],
            database: DATABASE,
            databaseLifecycle: {
                connect: () => {
                    throw new Error('connect failed');
                },
                disconnect: () => {
                    events.push('disconnect');
                },
            },
        });
        await expect(
            application.start({
                afterApps: () => {
                    events.push('di');
                },
            }),
        ).rejects.toThrow('connect failed');
        expect(configure).not.toHaveBeenCalled();
        expect(events).toEqual(['di', 'disconnect']);
        await application.shutdown();
        expect(events).toHaveLength(2);
    });
    it('rolls back before ready on route failure and continues all cleanup after errors', async () => {
        const events: string[] = [];
        const ready = vi.fn();
        const application = defineApplication({
            apps: [
                {
                    name: 'app',
                    ready,
                    shutdown: () => {
                        events.push('app');
                        throw new Error('app cleanup');
                    },
                },
            ],
            database: DATABASE,
            databaseLifecycle: {
                connect: () => {},
                disconnect: () => {
                    events.push('database');
                    throw new Error('db cleanup');
                },
            },
        });
        await expect(
            application.start({
                beforeReady: () => {
                    throw new Error('route registration');
                },
                afterApps: () => {
                    events.push('di');
                    throw new Error('di cleanup');
                },
            }),
        ).rejects.toMatchObject({ code: 'APPLICATION_START_FAILED', cause: expect.any(AggregateError) });
        expect(ready).not.toHaveBeenCalled();
        expect(events).toEqual(['app', 'di', 'database']);
        await application.shutdown();
        expect(events).toHaveLength(3);
    });
    it('disconnects after app and DI shutdown errors without retrying', async () => {
        const disconnect = vi.fn();
        const application = defineApplication({
            apps: [
                {
                    name: 'app',
                    shutdown: () => {
                        throw new Error('app');
                    },
                },
            ],
            database: DATABASE,
            databaseLifecycle: { connect: () => {}, disconnect },
        });
        await application.start({
            afterApps: () => {
                throw new Error('di');
            },
        });
        await expect(application.shutdown()).rejects.toMatchObject({
            code: 'APPLICATION_SHUTDOWN_FAILED',
            cause: expect.any(AggregateError),
        });
        expect(disconnect).toHaveBeenCalledOnce();
        await application.shutdown();
        expect(disconnect).toHaveBeenCalledOnce();
    });
    it('rejects malformed managed database registrations at construction', () => {
        expect(() => defineApplication({ apps: [], database: DATABASE, databaseLifecycle: {} as never })).toThrow(
            expect.objectContaining({ code: 'DATABASE_LIFECYCLE_INVALID' }),
        );
        expect(() =>
            defineApplication({ apps: [], database: DATABASE, databaseLifecycle: { connect: () => {} } as never }),
        ).toThrow(expect.objectContaining({ code: 'DATABASE_LIFECYCLE_INVALID' }));
    });
});
