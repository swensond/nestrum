import { describe, expect, it } from 'vitest';
import type { AppContext, AppDefinition, DatabaseConfig } from '../src/index.js';
import {
    AppError,
    AppLifecycleError,
    AppRegistry,
    AppRegistryError,
    defineApp,
    defineApplication,
} from '../src/index.js';

const DATABASES = {
    default: { kind: 'prisma', provider: 'postgresql', connection: 'postgresql://localhost/nestrum_test' },
} as const satisfies DatabaseConfig;

function gate(): { promise: Promise<void>; release: () => void } {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
        release = resolve;
    });

    return { promise, release };
}

function recordingApp(name: string, events: string[], dependsOn: readonly string[] = []): AppDefinition {
    return defineApp({
        name,
        dependsOn,
        configure() {
            events.push(`configure:${name}`);
        },
        ready() {
            events.push(`ready:${name}`);
        },
        shutdown() {
            events.push(`shutdown:${name}`);
        },
    });
}

async function failure(promise: Promise<void>): Promise<AppError> {
    try {
        await promise;
    } catch (error) {
        if (error instanceof AppError) {
            return error;
        }

        throw error;
    }

    throw new Error('Expected lifecycle failure.');
}

describe('AppRegistry', () => {
    it('registers only explicitly supplied apps and resolves them by name', () => {
        const registry = new AppRegistry([defineApp({ name: 'users' })]);

        expect(registry.has('users')).toBe(true);
        expect(registry.get('users').name).toBe('users');
        expect(registry.has('projects')).toBe(false);
        expect(() => registry.get('projects')).toThrow(AppRegistryError);
        expect(() => registry.get('projects')).toThrow('App "projects" is not registered.');
    });

    it('rejects duplicate app names even for the same definition', () => {
        const app = defineApp({ name: 'users' });

        expect(() => new AppRegistry([app, app])).toThrow(expect.objectContaining({ code: 'DUPLICATE_APP' }));
    });

    it('reports the app and its missing dependency', () => {
        expect(() => new AppRegistry([{ name: 'projects', dependsOn: ['users'] }])).toThrow(
            expect.objectContaining({
                code: 'MISSING_APP_DEPENDENCY',
                message: 'App "projects" depends on unregistered app "users".',
            }),
        );
    });

    it('rejects self-dependencies with a cycle path', () => {
        expect(() => new AppRegistry([{ name: 'users', dependsOn: ['users'] }])).toThrow('users -> users');
    });

    it('rejects indirect cycles with a cycle path', () => {
        expect(
            () =>
                new AppRegistry([
                    { name: 'projects', dependsOn: ['users'] },
                    { name: 'users', dependsOn: ['organizations'] },
                    { name: 'organizations', dependsOn: ['projects'] },
                ]),
        ).toThrow(
            expect.objectContaining({
                code: 'APP_DEPENDENCY_CYCLE',
                message: 'App dependency cycle: projects -> users -> organizations -> projects.',
            }),
        );
    });

    it('orders shared dependencies once and traverses registration/dependency order deterministically', () => {
        const definitions = [
            { name: 'projects', dependsOn: ['users', 'organizations', 'users'] },
            { name: 'analytics' },
            { name: 'organizations', dependsOn: ['identity'] },
            { name: 'users', dependsOn: ['identity'] },
            { name: 'identity' },
        ];

        for (let run = 0; run < 3; run++) {
            expect(new AppRegistry(definitions).all().map((app) => app.name)).toEqual([
                'identity',
                'users',
                'organizations',
                'projects',
                'analytics',
            ]);
        }
    });

    it('preserves registration order for independent apps', () => {
        expect(new AppRegistry([{ name: 'zebra' }, { name: 'alpha' }]).all().map((app) => app.name)).toEqual([
            'zebra',
            'alpha',
        ]);
    });

    it('snapshots definitions and dependency arrays so caller mutations cannot change the graph', () => {
        const dependencies = ['users'];
        const projects = { name: 'projects', dependsOn: dependencies };
        const definitions = [projects, { name: 'users' }];
        const registry = new AppRegistry(definitions);

        dependencies.push('missing');
        projects.name = 'renamed';
        definitions.length = 0;

        expect(registry.all().map((app) => app.name)).toEqual(['users', 'projects']);
        expect(registry.get('projects').dependsOn).toEqual(['users']);
        expect(Object.isFrozen(registry.get('projects'))).toBe(true);
        expect(Object.isFrozen(registry.get('projects').dependsOn)).toBe(true);
        expect(Object.isFrozen(registry.all())).toBe(true);
    });

    it('supports an empty explicitly registered app set', () => {
        expect(new AppRegistry([]).all()).toEqual([]);
    });
});

describe('defineApp', () => {
    it.each(['', ' ', ' users', 'users '])('rejects invalid app name %j', (name) => {
        expect(() => defineApp({ name })).toThrow(expect.objectContaining({ code: 'INVALID_APP_NAME' }));
    });

    it('copies and freezes the definition rather than freezing caller-owned objects', () => {
        const definition = { name: 'projects', dependsOn: ['users'] };
        const app = defineApp(definition);

        expect(app).not.toBe(definition);
        expect(Object.isFrozen(app)).toBe(true);
        expect(Object.isFrozen(definition)).toBe(false);
        expect(Object.isFrozen(definition.dependsOn)).toBe(false);
    });
});

describe('Application lifecycle', () => {
    it('validates the whole app graph before invoking any hook', () => {
        const events: string[] = [];

        expect(() =>
            defineApplication({ databases: DATABASES, apps: [recordingApp('projects', events, ['users'])] }),
        ).toThrow(AppRegistryError);
        expect(events).toEqual([]);
    });

    it('configures all apps before ready and shuts down in reverse topological order', async () => {
        const events: string[] = [];
        const application = defineApplication({
            databases: DATABASES,
            apps: [recordingApp('projects', events, ['users']), recordingApp('users', events)],
        });

        expect(application.state).toBe('created');
        expect(events).toEqual([]);
        await application.start();
        expect(application.state).toBe('ready');
        expect(events).toEqual(['configure:users', 'configure:projects', 'ready:users', 'ready:projects']);

        await application.shutdown();
        expect(application.state).toBe('stopped');
        expect(events).toEqual([
            'configure:users',
            'configure:projects',
            'ready:users',
            'ready:projects',
            'shutdown:projects',
            'shutdown:users',
        ]);
    });

    it('passes the application and registry through a frozen hook context', async () => {
        const contexts: AppContext[] = [];
        const application = defineApplication({
            databases: DATABASES,
            apps: [
                defineApp({
                    name: 'users',
                    configure(context) {
                        contexts.push(context);
                    },
                    ready(context) {
                        contexts.push(context);
                    },
                    shutdown(context) {
                        contexts.push(context);
                    },
                }),
            ],
        });

        await application.start();
        await application.shutdown();

        expect(contexts).toHaveLength(3);
        for (const context of contexts) {
            expect(context.application).toBe(application);
            expect(context.apps).toBe(application.apps);
            expect(context.apps.get('users').name).toBe('users');
            expect(Object.isFrozen(context)).toBe(true);
        }
    });

    it('awaits async configure hooks before proceeding', async () => {
        const blocked = gate();
        const events: string[] = [];
        const application = defineApplication({
            databases: DATABASES,
            apps: [
                defineApp({
                    name: 'users',
                    async configure() {
                        events.push('begin');
                        await blocked.promise;
                        events.push('end');
                    },
                }),
                recordingApp('projects', events, ['users']),
            ],
        });
        const starting = application.start();

        expect(application.state).toBe('starting');
        expect(events).toEqual(['begin']);
        blocked.release();
        await starting;

        expect(events).toEqual(['begin', 'end', 'configure:projects', 'ready:projects']);
        await application.shutdown();
    });

    it('awaits async ready hooks before reporting readiness', async () => {
        const entered = gate();
        const blocked = gate();
        const application = defineApplication({
            databases: DATABASES,
            apps: [
                defineApp({
                    name: 'users',
                    async ready() {
                        entered.release();
                        await blocked.promise;
                    },
                }),
            ],
        });
        const starting = application.start();
        await entered.promise;

        expect(application.state).toBe('starting');
        blocked.release();
        await starting;
        expect(application.state).toBe('ready');
        await application.shutdown();
    });

    it('awaits each shutdown hook before shutting down its dependency', async () => {
        const blocked = gate();
        const events: string[] = [];
        const application = defineApplication({
            databases: DATABASES,
            apps: [
                recordingApp('users', events),
                defineApp({
                    name: 'projects',
                    dependsOn: ['users'],
                    async shutdown() {
                        events.push('begin:projects');
                        await blocked.promise;
                        events.push('end:projects');
                    },
                }),
            ],
        });
        await application.start();
        events.length = 0;
        const stopping = application.shutdown();

        expect(application.state).toBe('stopping');
        expect(events).toEqual(['begin:projects']);
        blocked.release();
        await stopping;
        expect(events).toEqual(['begin:projects', 'end:projects', 'shutdown:users']);
    });

    it('allows missing hooks and an empty application', async () => {
        for (const apps of [[], [defineApp({ name: 'users' })]]) {
            const application = defineApplication({ databases: DATABASES, apps });
            await application.start();
            expect(application.state).toBe('ready');
            await application.shutdown();
            expect(application.state).toBe('stopped');
        }
    });

    it('does not repeat hooks for completed start/shutdown calls', async () => {
        const events: string[] = [];
        const application = defineApplication({ databases: DATABASES, apps: [recordingApp('users', events)] });

        await application.start();
        await application.start();
        await application.shutdown();
        await application.shutdown();

        expect(events).toEqual(['configure:users', 'ready:users', 'shutdown:users']);
        await expect(application.start()).rejects.toMatchObject({ code: 'APPLICATION_STATE_INVALID' });
    });

    it('shuts down an unstarted application without running hooks', async () => {
        const events: string[] = [];
        const application = defineApplication({ databases: DATABASES, apps: [recordingApp('users', events)] });

        await application.shutdown();
        expect(application.state).toBe('stopped');
        expect(events).toEqual([]);
        await expect(application.start()).rejects.toMatchObject({ code: 'APPLICATION_STATE_INVALID' });
    });

    it('rejects overlapping lifecycle calls during startup', async () => {
        const blocked = gate();
        const application = defineApplication({
            databases: DATABASES,
            apps: [defineApp({ name: 'users', configure: () => blocked.promise })],
        });
        const starting = application.start();

        await expect(application.start()).rejects.toMatchObject({ code: 'APPLICATION_STATE_INVALID' });
        await expect(application.shutdown()).rejects.toMatchObject({ code: 'APPLICATION_STATE_INVALID' });
        blocked.release();
        await starting;
        await application.shutdown();
    });

    it('rejects overlapping lifecycle calls during shutdown', async () => {
        const blocked = gate();
        const application = defineApplication({
            databases: DATABASES,
            apps: [defineApp({ name: 'users', shutdown: () => blocked.promise })],
        });
        await application.start();
        const stopping = application.shutdown();

        await expect(application.start()).rejects.toMatchObject({ code: 'APPLICATION_STATE_INVALID' });
        await expect(application.shutdown()).rejects.toMatchObject({ code: 'APPLICATION_STATE_INVALID' });
        blocked.release();
        await stopping;
    });

    it('rolls back only entered apps after configure failure, including the failing app', async () => {
        const events: string[] = [];
        const original = new Error('configure failure');
        const application = defineApplication({
            databases: DATABASES,
            apps: [
                recordingApp('users', events),
                defineApp({
                    name: 'projects',
                    dependsOn: ['users'],
                    configure() {
                        throw original;
                    },
                    shutdown() {
                        events.push('shutdown:projects');
                    },
                }),
                recordingApp('analytics', events),
            ],
        });

        const error = await failure(application.start());
        expect(error).toBeInstanceOf(AppLifecycleError);
        expect(error).toMatchObject({
            code: 'APP_HOOK_FAILED',
            appName: 'projects',
            hook: 'configure',
            cause: original,
        });
        expect(events).toEqual(['configure:users', 'shutdown:projects', 'shutdown:users']);
        expect(application.state).toBe('failed');
        await expect(application.start()).rejects.toMatchObject({ code: 'APPLICATION_STATE_INVALID' });
        await application.shutdown();
        expect(events).toHaveLength(3);
    });

    it('rolls back every configured app after an async ready failure', async () => {
        const events: string[] = [];
        const original = new Error('ready failure');
        const application = defineApplication({
            databases: DATABASES,
            apps: [
                defineApp({
                    name: 'users',
                    configure() {
                        events.push('configure:users');
                    },
                    async ready() {
                        throw original;
                    },
                    shutdown() {
                        events.push('shutdown:users');
                    },
                }),
                recordingApp('projects', events, ['users']),
            ],
        });

        await expect(application.start()).rejects.toMatchObject({ appName: 'users', hook: 'ready', cause: original });
        expect(events).toEqual(['configure:users', 'configure:projects', 'shutdown:projects', 'shutdown:users']);
        expect(application.state).toBe('failed');
    });

    it('preserves startup and rollback errors while attempting all rollback hooks', async () => {
        const events: string[] = [];
        const original = new Error('configure failure');
        const cleanup = new Error('cleanup failure');
        const application = defineApplication({
            databases: DATABASES,
            apps: [
                recordingApp('users', events),
                defineApp({
                    name: 'projects',
                    dependsOn: ['users'],
                    configure() {
                        throw original;
                    },
                    shutdown() {
                        throw cleanup;
                    },
                }),
            ],
        });

        const error = await failure(application.start());
        expect(error.code).toBe('APPLICATION_START_FAILED');
        expect(error.cause).toBeInstanceOf(AggregateError);
        if (error.cause instanceof AggregateError) {
            expect(error.cause.errors).toMatchObject([
                { appName: 'projects', hook: 'configure', cause: original },
                { appName: 'projects', hook: 'shutdown', cause: cleanup },
            ]);
        }

        expect(events).toEqual(['configure:users', 'shutdown:users']);
        expect(application.state).toBe('failed');
        await application.shutdown();
        expect(events).toHaveLength(2);
    });

    it('attempts remaining shutdown hooks after failures and reports all errors', async () => {
        const events: string[] = [];
        const application = defineApplication({
            databases: DATABASES,
            apps: [
                defineApp({
                    name: 'users',
                    shutdown() {
                        events.push('users');
                        throw new Error('users failure');
                    },
                }),
                defineApp({
                    name: 'projects',
                    dependsOn: ['users'],
                    async shutdown() {
                        events.push('projects');
                        throw new Error('projects failure');
                    },
                }),
            ],
        });
        await application.start();

        const error = await failure(application.shutdown());
        expect(error.code).toBe('APPLICATION_SHUTDOWN_FAILED');
        expect(error.cause).toBeInstanceOf(AggregateError);
        if (error.cause instanceof AggregateError) {
            expect(error.cause.errors).toMatchObject([
                { appName: 'projects', hook: 'shutdown' },
                { appName: 'users', hook: 'shutdown' },
            ]);
        }

        expect(events).toEqual(['projects', 'users']);
        expect(application.state).toBe('stopped');
        await application.shutdown();
        expect(events).toHaveLength(2);
    });
});
