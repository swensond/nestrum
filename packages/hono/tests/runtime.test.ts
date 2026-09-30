import type { Application, AuthorizationEnvironment, Subject } from '@nestrum/core';
import { AppError, AuthorizationError, allow, defineApplication, deny } from '@nestrum/core';
import { HTTPException } from 'hono/http-exception';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { RequestContext, RequestInputs, RequestScope, RuntimeErrorEvent } from '../src/index.js';
import { createHonoRuntime, createRuntimeContainer, mapHttpError } from '../src/index.js';

function application(apps: Parameters<typeof defineApplication>[0]['apps'] = []): Application {
    return defineApplication({
        apps,
        databases: { default: { kind: 'prisma', provider: 'postgresql', connection: 'unused' } },
    });
}

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });

    return { promise, resolve };
}

describe('Fetch-based Hono runtime', () => {
    it('rejects an admin UI without a configured private admin backend', async () => {
        const handle = vi.fn(async () => new Response('unreachable'));
        const runtime = createHonoRuntime({
            application: application(),
            adminUi: { basePath: '/admin', handle },
        });
        expect((await runtime.fetch(new Request('http://localhost/admin'))).status).toBe(503);
        await expect(runtime.start()).rejects.toMatchObject({ code: 'ADMIN_UI_CONFIG_INVALID' });
        expect(runtime.state).toBe('failed');
        expect(handle).not.toHaveBeenCalled();
        await runtime.shutdown();
    });

    it('gates traffic until ready and exposes actual InferDI scope values for anonymous requests', async () => {
        const app = application();
        const scopes: RequestScope[] = [];
        const runtime = createHonoRuntime({
            application: app,
            setupScope: (scope) => {
                scopes.push(scope);
            },
        });
        runtime.hono.get('/context', (context) => {
            const scope = context.var.di;
            expect(scope.get('application')).toBe(app);
            expect(scope.get('databases')).toBe(app.databases);
            expect(scope.get('authorization')).toBe(app.authorization);
            expect(scope.get('resources')).toBe(app.resources);
            expect(scope.get('request')).toBe(context.req.raw);
            expect(scope.get('subject')).toBe(context.var.nestrum.subject);
            expect(scope.get('environment')).toBe(context.var.nestrum.environment);

            return context.json({ subject: scope.get('subject'), environment: scope.get('environment') });
        });
        expect((await runtime.hono.request('/context')).status).toBe(503);
        expect(scopes).toHaveLength(0);
        await runtime.start();
        await runtime.start();
        const response = await runtime.hono.request('/context', {
            headers: { 'x-user-id': 'untrusted', authorization: 'Bearer ignored' },
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            subject: { anonymous: true },
            environment: { method: 'GET', path: '/context' },
        });
        expect(scopes[0]!.disposed).toBe(true);
        await runtime.shutdown();
        await runtime.shutdown();
        expect(runtime.state).toBe('stopped');
        expect(app.state).toBe('stopped');
        expect((await runtime.hono.request('/context')).status).toBe(503);
        await expect(runtime.start()).rejects.toMatchObject({ code: 'HTTP_RUNTIME_STATE_INVALID' });
    });

    it('isolates typed scoped services across concurrent requests and disposes in reverse creation order', async () => {
        const app = application();
        const disposal: string[] = [];
        class First {
            constructor(readonly subject: Subject) {}
            async dispose() {
                disposal.push(`first:${this.subject.id}`);
            }
        }
        class Second {
            constructor(
                readonly first: First,
                readonly environment: AuthorizationEnvironment,
            ) {}
            async dispose() {
                disposal.push(`second:${this.first.subject.id}`);
            }
        }
        const root = createRuntimeContainer(app)
            .registerClass('first', First, ['subject'], 'scoped')
            .registerClass('second', Second, ['first', 'environment'], 'scoped');
        const scopes: ReturnType<typeof open>[] = [];
        const open = (inputs: RequestInputs) => root.createScope(inputs);
        const arrived = deferred();
        const release = deferred();
        let requests = 0;
        const services: Second[] = [];
        const runtime = createHonoRuntime({
            application: app,
            di: { container: root, createScope: (inputs) => root.createScope(inputs) },
            resolveSubject: (request) => ({ id: new URL(request.url).searchParams.get('subject') }),
            resolveEnvironment: (_request, bindings) => ({ region: bindings.region }),
            setupScope: (scope) => {
                scopes.push(scope);
            },
        });
        runtime.hono.get('/parallel', async (context) => {
            const second = context.var.di.get('second');
            expect(context.var.di.get('second')).toBe(second);
            services.push(second);
            requests += 1;
            if (requests === 2) {
                arrived.resolve();
            }
            await release.promise;

            return context.json({ id: second.first.subject.id, region: second.environment.region });
        });
        await runtime.start();
        const alice = runtime.hono.request('/parallel?subject=alice', undefined, { region: 'one' });
        const bob = runtime.hono.request('/parallel?subject=bob', undefined, { region: 'two' });
        await arrived.promise;
        expect(services[0]).not.toBe(services[1]);
        expect(scopes.every((scope) => !scope.disposed)).toBe(true);
        release.resolve();
        expect(await (await alice).json()).toEqual({ id: 'alice', region: 'one' });
        expect(await (await bob).json()).toEqual({ id: 'bob', region: 'two' });
        expect(disposal.indexOf('second:alice')).toBeLessThan(disposal.indexOf('first:alice'));
        expect(disposal.indexOf('second:bob')).toBeLessThan(disposal.indexOf('first:bob'));
        expect(scopes.every((scope) => scope.disposed)).toBe(true);
        if (false) {
            // @ts-expect-error Concrete service keys remain compiler checked.
            scopes[0]!.get('missing');
            // @ts-expect-error Scoped services cannot resolve before required inputs exist.
            root.get('second');
            // @ts-expect-error A custom scope type requires a corresponding custom factory.
            createHonoRuntime<ReturnType<typeof open>>({ application: app });
        }
        await runtime.shutdown();
        expect(root.disposed).toBe(false);
        await root.dispose();
    });

    it('disposes scopes after validation, framework, unexpected, and non-Error failures', async () => {
        const scopes: RequestScope[] = [];
        const onError = vi.fn();
        const runtime = createHonoRuntime({
            application: application(),
            setupScope: (scope) => {
                scopes.push(scope);
            },
            onError,
        });
        runtime.hono.get('/deny', () => {
            throw new AuthorizationError('NOT_OWNER');
        });
        runtime.hono.get('/validation', () => {
            z.object({ id: z.number() }).parse({ id: 'invalid' });
            return new Response();
        });
        runtime.hono.get('/internal', () => {
            throw new Error('Secret database connection string');
        });
        runtime.hono.get('/value', () => {
            throw 'unexpected thrown value';
        });
        await runtime.start();
        const denied = await runtime.hono.request('/deny');
        expect(denied.status).toBe(403);
        expect(await denied.json()).toEqual({
            error: { code: 'AUTHORIZATION_DENIED', message: 'Authorization denied: NOT_OWNER.', reason: 'NOT_OWNER' },
        });
        const invalid = await runtime.hono.request('/validation');
        expect(invalid.status).toBe(400);
        expect(await invalid.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR', issues: [{ path: ['id'] }] } });
        for (const path of ['/internal', '/value']) {
            const response = await runtime.hono.request(path);
            expect(response.status).toBe(500);
            expect(await response.json()).toEqual({
                error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error.' },
            });
        }
        expect(onError).toHaveBeenCalledTimes(4);
        expect(scopes.every((scope) => scope.disposed)).toBe(true);
        await runtime.shutdown();
    });

    it('disposes setup-failed scopes and never calls a route', async () => {
        const scopes: RequestScope[] = [];
        const route = vi.fn(() => new Response('unreachable'));
        const runtime = createHonoRuntime({
            application: application(),
            onError: vi.fn(),
            setupScope: (scope) => {
                scopes.push(scope);
                throw new AppError('SETUP_FAILED', 'Private setup failure');
            },
        });
        runtime.hono.get('/', route);
        await runtime.start();
        const response = await runtime.hono.request('/');
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ error: { code: 'SETUP_FAILED', message: 'Internal server error.' } });
        expect(route).not.toHaveBeenCalled();
        expect(scopes[0]!.disposed).toBe(true);
        await runtime.shutdown();
    });

    it('resolves async scoped services once and awaits their disposal', async () => {
        const app = application();
        const dispose = vi.fn(async () => {});
        const root = createRuntimeContainer(app).registerAsyncFactory(
            'service',
            async (subject: Subject) => ({ subject, dispose }),
            ['subject'],
            'scoped',
        );
        const runtime = createHonoRuntime({
            application: app,
            di: { container: root, createScope: async (inputs) => root.createScope(inputs) },
        });
        runtime.hono.get('/', async (context) => {
            const [one, two] = await Promise.all([
                context.var.di.getAsync('service'),
                context.var.di.getAsync('service'),
            ]);
            expect(one).toBe(two);
            expect(one.subject).toEqual({ anonymous: true });

            return context.text('resolved');
        });
        await runtime.start();
        expect((await runtime.hono.request('/')).status).toBe(200);
        expect(dispose).toHaveBeenCalledOnce();
        await runtime.shutdown();
        await root.dispose();
    });

    it('passes trusted resolver subjects and environments into the existing default-deny engine', async () => {
        const app = defineApplication({
            apps: [],
            databases: { default: { kind: 'prisma', provider: 'postgresql', connection: 'unused' } },
            policies: [
                {
                    resource: 'admin',
                    actions: {
                        'admin.access': {
                            authorize: ({ subject, environment }) =>
                                subject.id === 'alice' && environment.trusted ? allow() : deny('ANONYMOUS'),
                        },
                    },
                },
            ],
        });
        const runtime = createHonoRuntime({
            application: app,
            resolveSubject: () => ({ id: 'alice' }),
            resolveEnvironment: () => ({ trusted: true }),
            onError: vi.fn(),
        });
        runtime.hono.get('/', async (context) => {
            const scope = context.var.di;
            const decision = await scope.get('authorization').authorize({
                identity: 'admin',
                action: 'admin.access',
                subject: scope.get('subject'),
                environment: scope.get('environment'),
            });
            if (!decision.allowed) {
                throw new AuthorizationError(decision.reason);
            }

            return context.text('authorized');
        });
        await runtime.start();
        expect((await runtime.hono.request('/')).status).toBe(200);
        await runtime.shutdown();
    });

    it('awaits asynchronous cleanup before returning and reports disposal failures without replacing the response', async () => {
        const app = application();
        const reachedDispose = deferred();
        const releaseDispose = deferred();
        const disposeError = new Error('dispose failure');
        class Service {
            async dispose() {
                reachedDispose.resolve();
                await releaseDispose.promise;
                throw disposeError;
            }
        }
        const root = createRuntimeContainer(app).registerClass('service', Service, [], 'scoped');
        const events: { error: unknown; event: RuntimeErrorEvent }[] = [];
        const runtime = createHonoRuntime({
            application: app,
            di: { container: root, createScope: (inputs) => root.createScope(inputs) },
            onError: (error, event) => {
                events.push({ error, event });
            },
        });
        runtime.hono.get('/', (context) => {
            context.var.di.get('service');
            return context.text('success', 201);
        });
        await runtime.start();
        let returned = false;
        const pending = Promise.resolve(runtime.hono.request('/')).then((response) => {
            returned = true;
            return response;
        });
        await reachedDispose.promise;
        expect(returned).toBe(false);
        releaseDispose.resolve();
        const response = await pending;
        expect(response.status).toBe(201);
        expect(await response.text()).toBe('success');
        expect(events).toHaveLength(1);
        expect(events[0]!.event.phase).toBe('scope-dispose');
        expect((events[0]!.error as AggregateError).errors).toContain(disposeError);
        await runtime.shutdown();
        await root.dispose();
    });

    it('maps unmatched routes and HTTP exceptions into the same error envelope', async () => {
        const scopes: RequestScope[] = [];
        const runtime = createHonoRuntime({
            application: application(),
            onError: vi.fn(),
            setupScope: (scope) => {
                scopes.push(scope);
            },
        });
        runtime.hono.get('/unauthenticated', () => {
            throw new HTTPException(401, {
                res: new Response('custom body', {
                    status: 401,
                    headers: [
                        ['WWW-Authenticate', 'Bearer'],
                        ['Content-Length', '500'],
                        ['Content-Encoding', 'gzip'],
                        ['Set-Cookie', 'one=1; HttpOnly'],
                        ['Set-Cookie', 'two=2; HttpOnly'],
                    ],
                }),
                message: 'Login required',
            });
        });
        await runtime.start();
        expect(await (await runtime.hono.request('/missing')).json()).toEqual({
            error: { code: 'NOT_FOUND', message: 'Route not found.' },
        });
        const response = await runtime.hono.request('/unauthenticated');
        expect(response.status).toBe(401);
        expect(response.headers.get('www-authenticate')).toBe('Bearer');
        expect(response.headers.has('content-length')).toBe(false);
        expect(response.headers.has('content-encoding')).toBe(false);
        expect(response.headers.getSetCookie()).toEqual(['one=1; HttpOnly', 'two=2; HttpOnly']);
        expect(await response.json()).toEqual({ error: { code: 'HTTP_ERROR', message: 'Login required' } });
        expect(scopes.every((scope) => scope.disposed)).toBe(true);
        await runtime.shutdown();
    });

    it('stops accepting traffic, drains requests including disposal, then runs application shutdown', async () => {
        const arrived = deferred();
        const release = deferred();
        const scopes: RequestScope[] = [];
        const shutdown = vi.fn(() => {
            expect(scopes[0]!.disposed).toBe(true);
        });
        const runtime = createHonoRuntime({
            application: application([{ name: 'example', shutdown }]),
            setupScope: (scope) => {
                scopes.push(scope);
            },
        });
        runtime.hono.get('/', async (context) => {
            arrived.resolve();
            await release.promise;
            return context.text('complete');
        });
        await runtime.start();
        const response = runtime.hono.request('/');
        await arrived.promise;
        const stopping = runtime.shutdown();
        expect(runtime.state).toBe('stopping');
        expect((await runtime.hono.request('/')).status).toBe(503);
        expect(shutdown).not.toHaveBeenCalled();
        await expect(runtime.shutdown()).rejects.toMatchObject({ code: 'HTTP_RUNTIME_STATE_INVALID' });
        release.resolve();
        expect(await (await response).text()).toBe('complete');
        await stopping;
        expect(shutdown).toHaveBeenCalledTimes(1);
        expect(runtime.state).toBe('stopped');
    });

    it('fails startup before accepting traffic and cleans up lifecycle failures', async () => {
        const runtime = createHonoRuntime({
            application: application([
                {
                    name: 'broken',
                    configure() {
                        throw new Error('broken');
                    },
                },
            ]),
        });
        await expect(runtime.start()).rejects.toMatchObject({ code: 'APP_HOOK_FAILED' });
        expect(runtime.state).toBe('failed');
        expect((await runtime.hono.request('/')).status).toBe(503);
        await runtime.shutdown();
        const shutdownFailure = createHonoRuntime({
            application: application([
                {
                    name: 'broken',
                    shutdown() {
                        throw new Error('shutdown');
                    },
                },
            ]),
        });
        await shutdownFailure.start();
        await expect(shutdownFailure.shutdown()).rejects.toMatchObject({ code: 'HTTP_RUNTIME_SHUTDOWN_FAILED' });
        expect(shutdownFailure.state).toBe('stopped');
    });

    it('snapshots resolver attributes, rejects invalid context values, and accepts a detached Fetch handler', async () => {
        const subject = { id: 'alice', details: { region: 'original' } };
        const contexts: RequestContext[] = [];
        const runtime = createHonoRuntime({
            application: application(),
            resolveSubject: () => subject,
            resolveEnvironment: () => ({ custom: true, method: 'POST', path: '/spoofed' }),
            setupScope: (_scope, context) => {
                contexts.push(context);
            },
        });
        runtime.hono.get('/', (context) => context.json(context.var.nestrum.subject));
        await runtime.start();
        const fetch = runtime.fetch;
        expect((await fetch(new Request('http://localhost/'))).status).toBe(200);
        subject.details.region = 'changed';
        expect(contexts[0]!.subject.details).toEqual({ region: 'original' });
        expect(contexts[0]!.environment).toEqual({ custom: true, method: 'GET', path: '/' });
        expect(Object.isFrozen(contexts[0])).toBe(true);
        await runtime.shutdown();
        const invalid = createHonoRuntime({
            application: application(),
            resolveSubject: () => null as never,
            onError: vi.fn(),
        });
        await invalid.start();
        expect((await invalid.hono.request('/')).status).toBe(500);
        await invalid.shutdown();
    });

    it('keeps error observer failures from replacing original responses', async () => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            const runtime = createHonoRuntime({
                application: application(),
                onError: () => {
                    throw new Error('observer error');
                },
            });
            runtime.hono.get('/', () => {
                throw new AuthorizationError('DENIED');
            });
            await runtime.start();
            expect((await runtime.hono.request('/')).status).toBe(403);
            expect(log).toHaveBeenCalledTimes(1);
            await runtime.shutdown();
        } finally {
            log.mockRestore();
        }
    });

    it('drains asynchronous error reporting after resolver failure before application shutdown', async () => {
        const reporting = deferred();
        const release = deferred();
        const shutdown = vi.fn();
        const runtime = createHonoRuntime({
            application: application([{ name: 'app', shutdown }]),
            resolveSubject: () => {
                throw new Error('resolver failure');
            },
            onError: async () => {
                reporting.resolve();
                await release.promise;
            },
        });
        await runtime.start();
        const request = runtime.hono.request('/');
        await reporting.promise;
        const stopping = runtime.shutdown();
        expect(shutdown).not.toHaveBeenCalled();
        release.resolve();
        expect((await request).status).toBe(500);
        await stopping;
        expect(shutdown).toHaveBeenCalledOnce();
    });
});

describe('Consistent safe error mapping', () => {
    it('redacts internal framework errors and validates error statuses', () => {
        expect(
            mapHttpError(new AppError('DATABASE_FAILED', 'private credentials', 500, { cause: new Error('secret') })),
        ).toEqual({ status: 500, body: { error: { code: 'DATABASE_FAILED', message: 'Internal server error.' } } });
        expect(mapHttpError(new AppError('BAD_STATUS', 'private', 200)).status).toBe(500);
        expect(mapHttpError(new HTTPException(500, { message: 'private' })).body.error.message).toBe(
            'Internal server error.',
        );
    });
});
