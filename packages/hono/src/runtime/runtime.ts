import { OpenAPIHono } from '@hono/zod-openapi';
import type { Hono } from 'hono';
import type { Context } from 'hono';
import { inferdiHono } from '@inferdi/hono';
import type { InferdiRoot, InferdiScope } from '@inferdi/hono';
import { AppError, snapshotQueryValue } from '@nestrum/core';
import type { Subject, AuthorizationEnvironment } from '@nestrum/core';
import { createRuntimeContainer, openRequestScope } from './container.js';
import type { RequestScope } from './container.js';
import { mapHttpError } from './runtime.errors.js';
import type { RequestContext, RuntimeEnv, RuntimeErrorEvent, RuntimeOptions, RuntimeState } from './runtime.types.js';
import { registerPublicApi } from '#hono/api/public-api';
import type { PublicOpenApiDocument } from '#hono/api/public-api';

function attributes<Value extends Subject | AuthorizationEnvironment>(value: Value): Value {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)) {
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

    constructor(private readonly options: RuntimeOptions<Scope>) {
        options = Object.freeze({ ...options, ...(options.di === undefined ? {} : { di: Object.freeze({ ...options.di }) }),
            ...(options.publicApi === undefined ? {} : { publicApi: Object.freeze({ ...options.publicApi,
                ...(options.publicApi.temporal === undefined ? {} : { temporal: Object.freeze({ ...options.publicApi.temporal }) }) }) }) });
        this.options = options;
        const root = createRuntimeContainer(options.application);
        const configured = options.di;
        this.disposeRoot = configured === undefined ? () => root.dispose() : undefined;
        this.hono = new OpenAPIHono<RuntimeEnv<Scope>>();
        this.hono.notFound((context) => context.json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } }, 404));
        this.hono.onError((error, context) => this.respondToError(error, context));
        this.hono.use('*', async (context, next) => {
            if (this.currentState !== 'ready' || options.application.state !== 'ready') {
                return context.json({ error: { code: 'HTTP_RUNTIME_NOT_READY', message: 'Service unavailable.' } }, 503);
            }
            this.activeRequests += 1;
            try {
                const request = context.req.raw;
                const bindings = context.env ?? {};
                const subject = attributes(options.resolveSubject ? await options.resolveSubject(request, bindings) : await options.application.auth?.resolveSubject(request) ?? { anonymous: true });
                const extra = attributes(options.resolveEnvironment ? await options.resolveEnvironment(request, bindings) : {});
                const environment = Object.freeze({ ...extra, method: request.method, path: new URL(request.url).pathname });
                const application = options.application;
                const requestContext: RequestContext = Object.freeze({ application, databases: application.databases, resources: application.resources,
                    authorization: application.authorization, subject, environment, request });
                context.set('nestrum', requestContext);
                await next();
            } catch (error) {
                return await this.respondToError(error, context);
            } finally {
                this.activeRequests -= 1;
                if (this.activeRequests === 0) { this.drain?.(); }
            }
        });
        this.hono.use('*', inferdiHono<InferdiRoot, RuntimeEnv<Scope>, Scope>({
            container: configured?.container ?? root,
            createScope: (_container, context) => {
                const { subject, environment, request } = context.get('nestrum');

                return configured ? configured.createScope({ subject, environment, request }) : openRequestScope(root, { subject, environment, request }) as unknown as Scope;
            },
            setupScope: (scope, context) => options.setupScope?.(scope, context.get('nestrum')),
            onDisposeError: (error, context) => this.reportError(error, { phase: 'scope-dispose', request: context.req.raw, context: context.get('nestrum') })
        }));
    }

    get state(): RuntimeState { return this.currentState; }

    getOpenApiDocument(): PublicOpenApiDocument {
        if (!this.publicDocument) { throw new AppError('HTTP_RUNTIME_NOT_READY', 'Public API metadata is available after successful startup.'); }

        return snapshotQueryValue(this.publicDocument);
    }

    async start(): Promise<void> {
        if (this.currentState === 'ready') { return; }
        if (this.currentState !== 'created') { throw this.invalidState('start'); }
        this.currentState = 'starting';
        try {
            await this.options.application.start();
            const auth = this.options.application.auth;
            if (auth) {
                if (this.hono.routes.some((route) => route.method !== 'ALL' && (route.path.startsWith(auth.basePath) || route.path.startsWith('/api/:') || route.path === '/api/*'))) {
                    throw new AppError('HTTP_AUTH_ROUTE_CONFLICT', 'Authentication routes overlap an existing route.');
                }
                this.hono.on(['GET', 'POST'], `${auth.basePath}/*`, (context) => auth.handle(context.req.raw));
            }
            this.publicDocument = registerPublicApi(this.hono, this.options.application.resources.all(), this.options.publicApi);
            this.currentState = 'ready';
        } catch (error) {
            this.currentState = 'failed';
            const errors: unknown[] = [error];
            if (this.options.application.state === 'ready') {
                try { await this.options.application.shutdown(); } catch (cleanupError) { errors.push(cleanupError); }
            }
            try { await this.disposeRoot?.(); } catch (cleanupError) { errors.push(cleanupError); }
            if (errors.length > 1) { throw new AppError('HTTP_RUNTIME_START_FAILED', 'Runtime startup and cleanup failed.', 500, { cause: new AggregateError(errors) }); }
            throw error;
        }
    }

    async shutdown(): Promise<void> {
        if (this.currentState === 'stopped') { return; }
        if (this.currentState === 'starting' || this.currentState === 'stopping') { throw this.invalidState('shutdown'); }
        this.currentState = 'stopping';
        if (this.activeRequests > 0) { await new Promise<void>((resolve) => { this.drain = resolve; }); }
        const errors: unknown[] = [];
        try { await this.options.application.shutdown(); } catch (error) { errors.push(error); }
        try { await this.disposeRoot?.(); } catch (error) { errors.push(error); }
        this.currentState = 'stopped';
        this.drain = undefined;
        if (errors.length) { throw new AppError('HTTP_RUNTIME_SHUTDOWN_FAILED', 'Runtime shutdown failed.', 500, { cause: new AggregateError(errors) }); }
    }

    readonly fetch: Hono<RuntimeEnv<Scope>>['fetch'] = (request, bindings, executionContext) => this.hono.fetch(request, bindings, executionContext);

    private invalidState(operation: string): AppError {
        return new AppError('HTTP_RUNTIME_STATE_INVALID', `Cannot ${operation} HTTP runtime while ${this.currentState}.`);
    }

    private async respondToError(error: unknown, context: Context<RuntimeEnv<Scope>>): Promise<Response> {
        await this.reportError(error, { phase: 'request', request: context.req.raw,
            ...(context.get('nestrum') === undefined ? {} : { context: context.get('nestrum') }) });
        const mapped = mapHttpError(error);

        return context.json(mapped.body, mapped.status, mapped.headers);
    }

    private async reportError(error: unknown, event: RuntimeErrorEvent): Promise<void> {
        try {
            if (this.options.onError) { await this.options.onError(error, event); }
            else { console.error('Nestrum HTTP runtime error', error); }
        } catch (observerError) {
            try { console.error('Nestrum HTTP error observer failed', error, observerError); } catch { /* Logging must not replace the response. */ }
        }
    }
}

export function createHonoRuntime(options: RuntimeOptions<RequestScope> & { readonly di?: undefined }): HonoRuntime<RequestScope>;
export function createHonoRuntime<Scope extends InferdiScope>(options: RuntimeOptions<Scope> & { readonly di: NonNullable<RuntimeOptions<Scope>['di']> }): HonoRuntime<Scope>;
export function createHonoRuntime<Scope extends InferdiScope = RequestScope>(options: RuntimeOptions<Scope>): HonoRuntime<Scope> {
    return new HonoRuntime(options);
}
