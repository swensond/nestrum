import { OpenAPIHono } from '@hono/zod-openapi';
import type { InferdiRoot, InferdiScope } from '@inferdi/hono';
import { inferdiHono } from '@inferdi/hono';
import type { AuthorizationEnvironment, Subject } from '@nestrum/core';
import { API_KEY_HEADER, AppError, apiKeySubject, snapshotQueryValue } from '@nestrum/core';
import type { Context, Hono } from 'hono';
import type { PublicOpenApiDocument } from '#hono/api/public-api';
import { OPENAPI_PATH, pathsOverlap, registerPublicApi } from '#hono/api/public-api';
import type { RequestScope } from './container.js';
import { createRuntimeContainer, openRequestScope } from './container.js';
import { mapHttpError } from './runtime.errors.js';
import type { RequestContext, RuntimeEnv, RuntimeErrorEvent, RuntimeOptions, RuntimeState } from './runtime.types.js';

function attributes<Value extends Subject | AuthorizationEnvironment>(value: Value): Value {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)
    ) {
        throw new AppError('HTTP_CONTEXT_INVALID', 'Subject and environment resolvers must return attribute records.');
    }

    return Object.freeze(snapshotQueryValue(value));
}

export class HonoRuntime<Scope extends InferdiScope = RequestScope> {
    readonly hono: OpenAPIHono<RuntimeEnv<Scope>>;
    private publicDocument: PublicOpenApiDocument | undefined;
    private currentState: RuntimeState = 'created';
    private activeRequests = 0;
    private drain: (() => void) | undefined;
    private readonly disposeRoot: (() => Promise<void>) | undefined;
    private rootDisposed = false;
    private hostStopped = false;
    private readonly frameworkRouteCount: number;

    constructor(private readonly options: RuntimeOptions<Scope>) {
        if (
            options.drainTimeoutMs !== undefined &&
            (!Number.isFinite(options.drainTimeoutMs) || options.drainTimeoutMs <= 0)
        ) {
            throw new AppError('HTTP_RUNTIME_CONFIG_INVALID', 'Drain timeout must be a positive finite number.');
        }
        options = Object.freeze({
            ...options,
            ...(options.di === undefined ? {} : { di: Object.freeze({ ...options.di }) }),
            ...(options.publicApi === undefined
                ? {}
                : {
                      publicApi: Object.freeze({
                          ...options.publicApi,
                          ...(options.publicApi.temporal === undefined
                              ? {}
                              : { temporal: Object.freeze({ ...options.publicApi.temporal }) }),
                      }),
                  }),
        });
        this.options = options;
        const root = createRuntimeContainer(options.application);
        const configured = options.di;
        this.disposeRoot =
            configured === undefined
                ? () => root.dispose()
                : configured.dispose
                  ? async () => configured.dispose?.()
                  : undefined;
        this.hono = new OpenAPIHono<RuntimeEnv<Scope>>();
        this.hono.notFound((context) =>
            context.json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } }, 404),
        );
        this.hono.onError((error, context) => this.respondToError(error, context));
        this.hono.use('*', async (context, next) => {
            if (this.currentState !== 'ready' || options.application.state !== 'ready') {
                return context.json(
                    { error: { code: 'HTTP_RUNTIME_NOT_READY', message: 'Service unavailable.' } },
                    503,
                );
            }
            this.activeRequests += 1;
            try {
                const request = context.req.raw;
                const bindings = context.env ?? {};
                const subject = attributes(
                    options.resolveSubject
                        ? await options.resolveSubject(request, bindings)
                        : await this.resolveSubject(request),
                );
                const extra = attributes(
                    options.resolveEnvironment ? await options.resolveEnvironment(request, bindings) : {},
                );
                const environment = Object.freeze({
                    ...extra,
                    method: request.method,
                    path: new URL(request.url).pathname,
                });
                const application = options.application;
                const requestContext: RequestContext = Object.freeze({
                    application,
                    databases: application.databases,
                    resources: application.resources,
                    authorization: application.authorization,
                    subject,
                    environment,
                    request,
                });
                context.set('nestrum', requestContext);
                await next();
            } catch (error) {
                return await this.respondToError(error, context);
            } finally {
                this.activeRequests -= 1;
                if (this.activeRequests === 0) {
                    this.drain?.();
                }
            }
        });
        this.hono.use(
            '*',
            inferdiHono<InferdiRoot, RuntimeEnv<Scope>, Scope>({
                container: configured?.container ?? root,
                createScope: (_container, context) => {
                    const { subject, environment, request } = context.get('nestrum');

                    return configured
                        ? configured.createScope({ subject, environment, request })
                        : (openRequestScope(root, { subject, environment, request }) as unknown as Scope);
                },
                setupScope: (scope, context) => options.setupScope?.(scope, context.get('nestrum')),
                onDisposeError: (error, context) =>
                    this.reportError(error, {
                        phase: 'scope-dispose',
                        request: context.req.raw,
                        context: context.get('nestrum'),
                    }),
            }),
        );
        this.frameworkRouteCount = this.hono.routes.length;
    }

    get state(): RuntimeState {
        return this.currentState;
    }

    getOpenApiDocument(): PublicOpenApiDocument {
        if (!this.publicDocument) {
            throw new AppError('HTTP_RUNTIME_NOT_READY', 'Public API metadata is available after successful startup.');
        }

        return snapshotQueryValue(this.publicDocument);
    }

    async start(): Promise<void> {
        if (this.currentState === 'ready') {
            return;
        }
        if (this.currentState !== 'created') {
            throw this.invalidState('start');
        }
        this.currentState = 'starting';
        try {
            if (this.options.application.state !== 'created') {
                throw new AppError(
                    'HTTP_APPLICATION_STATE_INVALID',
                    'Runtime startup requires an unstarted application.',
                );
            }
            await this.options.application.start({
                beforeReady: () => this.registerRoutes(),
                afterApps: () => this.disposeContainer(),
            });
            this.currentState = 'ready';
        } catch (error) {
            this.currentState = 'failed';
            const errors: unknown[] = [error];
            try {
                await this.disposeContainer();
            } catch (cleanupError) {
                errors.push(cleanupError);
            }
            if (errors.length > 1) {
                throw new AppError('HTTP_RUNTIME_START_FAILED', 'Runtime startup and cleanup failed.', 500, {
                    cause: new AggregateError(errors),
                });
            }
            throw error;
        }
    }

    /**
     * A credential in `X-API-Key` authenticates a request to the public resource API as an explicit API-key subject;
     * the key wins over any session cookie and never creates a session. Admin, the auth endpoints, and the OpenAPI
     * document never consult keys, so a key cannot reach them.
     */
    private async resolveSubject(request: Request): Promise<Subject> {
        const auth = this.options.application.auth;
        if (!auth) {
            return { anonymous: true };
        }
        const path = new URL(request.url).pathname;
        if (
            request.headers.has(API_KEY_HEADER) &&
            path.startsWith('/api/') &&
            path !== OPENAPI_PATH &&
            !path.startsWith(`${auth.basePath}/`)
        ) {
            const principal = await auth.apiKeys.authenticate(request);
            if (principal) {
                return apiKeySubject(principal);
            }
        }

        return auth.resolveSubject(request);
    }

    private registerRoutes(): void {
        const admin = this.options.application.admin;
        if (admin) {
            if (
                this.hono.routes
                    .slice(this.frameworkRouteCount)
                    .some((route) => pathsOverlap(route.path, `${admin.basePath}/*`))
            ) {
                throw new AppError('ADMIN_ROUTE_CONFLICT', 'Admin routes overlap an existing route.');
            }
            const handle = (context: Context<RuntimeEnv<Scope>>) => {
                const { subject, environment } = context.get('nestrum');

                return admin.handle(context.req.raw, {
                    subject,
                    environment,
                    reportError: (error) =>
                        this.reportError(error, {
                            phase: 'request',
                            request: context.req.raw,
                            context: context.get('nestrum'),
                        }),
                });
            };
            this.hono.all(admin.basePath, handle);
            this.hono.all(`${admin.basePath}/*`, handle);
        }
        const auth = this.options.application.auth;
        const adminUi = this.options.adminUi;
        if (adminUi) {
            if (!admin || adminUi.basePath !== '/admin' || typeof adminUi.handle !== 'function') {
                throw new AppError(
                    'ADMIN_UI_CONFIG_INVALID',
                    'Admin UI requires configured admin and a /admin Fetch handler.',
                );
            }
            if (
                this.hono.routes
                    .slice(this.frameworkRouteCount)
                    .some((route) => pathsOverlap(route.path, `${adminUi.basePath}/*`))
            ) {
                throw new AppError('ADMIN_UI_ROUTE_CONFLICT', 'Admin UI routes overlap an existing route.');
            }
            const handle = (context: Context<RuntimeEnv<Scope>>) =>
                adminUi.handle(context.req.raw, {
                    fetch: (request) => Promise.resolve(this.fetch(request, context.env)),
                });
            this.hono.all(adminUi.basePath, handle);
            this.hono.all(`${adminUi.basePath}/*`, handle);
        }
        if (auth) {
            if (
                this.hono.routes.some(
                    (route) =>
                        route.method !== 'ALL' &&
                        (route.path.startsWith(auth.basePath) ||
                            route.path.startsWith('/api/:') ||
                            route.path === '/api/*'),
                )
            ) {
                throw new AppError('HTTP_AUTH_ROUTE_CONFLICT', 'Authentication routes overlap an existing route.');
            }
            this.hono.on(['GET', 'POST'], `${auth.basePath}/*`, (context) => auth.handle(context.req.raw));
        }
        if (!auth && this.options.application.resources.all().some((r) => r.apiAccess.auth.includes('api-key'))) {
            throw new AppError(
                'HTTP_API_AUTH_UNCONFIGURED',
                'Resources that accept API keys require configured authentication.',
            );
        }
        this.publicDocument = registerPublicApi(
            this.hono,
            this.options.application.resources.all(),
            this.options.publicApi,
        );
    }

    private async disposeContainer(): Promise<void> {
        if (this.rootDisposed) {
            return;
        }
        this.rootDisposed = true;
        await this.disposeRoot?.();
    }

    async shutdown(): Promise<void> {
        if (this.currentState === 'stopped') {
            return;
        }
        if (this.currentState === 'starting' || this.currentState === 'stopping') {
            throw this.invalidState('shutdown');
        }
        this.currentState = 'stopping';
        const errors: unknown[] = [];
        if (!this.hostStopped) {
            this.hostStopped = true;
            try {
                await this.options.stopTraffic?.();
            } catch (error) {
                errors.push(error);
            }
        }
        if (this.activeRequests > 0) {
            try {
                await new Promise<void>((resolve, reject) => {
                    const timer =
                        this.options.drainTimeoutMs === undefined
                            ? undefined
                            : setTimeout(() => {
                                  this.drain = undefined;
                                  reject(
                                      new AppError(
                                          'HTTP_RUNTIME_DRAIN_TIMEOUT',
                                          'Active requests did not drain; resources remain open for a later shutdown retry.',
                                      ),
                                  );
                              }, this.options.drainTimeoutMs);
                    this.drain = () => {
                        if (timer !== undefined) {
                            clearTimeout(timer);
                        }
                        resolve();
                    };
                });
            } catch (error) {
                this.currentState = 'failed';
                throw errors.length
                    ? new AppError(
                          'HTTP_RUNTIME_DRAIN_TIMEOUT',
                          'Traffic stop and drain failed; resources remain open.',
                          500,
                          { cause: new AggregateError([...errors, error]) },
                      )
                    : error;
            }
        }
        try {
            await this.options.application.shutdown();
        } catch (error) {
            errors.push(error);
        }
        try {
            await this.disposeContainer();
        } catch (error) {
            errors.push(error);
        }
        this.currentState = 'stopped';
        this.drain = undefined;
        if (errors.length) {
            throw new AppError('HTTP_RUNTIME_SHUTDOWN_FAILED', 'Runtime shutdown failed.', 500, {
                cause: new AggregateError(errors),
            });
        }
    }

    readonly fetch: Hono<RuntimeEnv<Scope>>['fetch'] = (request, bindings, executionContext) => {
        // Reject before routing so an early request cannot freeze Hono's route matcher.
        if (this.currentState !== 'ready' || this.options.application.state !== 'ready') {
            return Response.json(
                { error: { code: 'HTTP_RUNTIME_NOT_READY', message: 'Service unavailable.' } },
                { status: 503 },
            );
        }

        return this.hono.fetch(request, bindings, executionContext);
    };

    private invalidState(operation: string): AppError {
        return new AppError(
            'HTTP_RUNTIME_STATE_INVALID',
            `Cannot ${operation} HTTP runtime while ${this.currentState}.`,
        );
    }

    private async respondToError(error: unknown, context: Context<RuntimeEnv<Scope>>): Promise<Response> {
        await this.reportError(error, {
            phase: 'request',
            request: context.req.raw,
            ...(context.get('nestrum') === undefined ? {} : { context: context.get('nestrum') }),
        });
        const mapped = mapHttpError(error);

        return context.json(mapped.body, mapped.status, mapped.headers);
    }

    private async reportError(error: unknown, event: RuntimeErrorEvent): Promise<void> {
        try {
            if (this.options.onError) {
                await this.options.onError(error, event);
            } else {
                console.error('Nestrum HTTP runtime error', error);
            }
        } catch (observerError) {
            try {
                console.error('Nestrum HTTP error observer failed', error, observerError);
            } catch {
                /* Logging must not replace the response. */
            }
        }
    }
}

export function createHonoRuntime(
    options: RuntimeOptions<RequestScope> & { readonly di?: undefined },
): HonoRuntime<RequestScope>;
export function createHonoRuntime<Scope extends InferdiScope>(
    options: RuntimeOptions<Scope> & { readonly di: NonNullable<RuntimeOptions<Scope>['di']> },
): HonoRuntime<Scope>;
export function createHonoRuntime<Scope extends InferdiScope = RequestScope>(
    options: RuntimeOptions<Scope>,
): HonoRuntime<Scope> {
    return new HonoRuntime(options);
}
