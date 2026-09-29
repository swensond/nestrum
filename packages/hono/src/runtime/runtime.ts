import { Hono } from 'hono';
import type { Context } from 'hono';
import { inferdiHono } from '@inferdi/hono';
import type { InferdiRoot, InferdiScope } from '@inferdi/hono';
import { AppError, snapshotQueryValue } from '@nestrum/core';
import type { Subject, AuthorizationEnvironment } from '@nestrum/core';
import { createRuntimeContainer, openRequestScope } from './container.js';
import type { RequestScope } from './container.js';
import { mapHttpError } from './runtime.errors.js';
import type { RequestContext, RuntimeEnv, RuntimeErrorEvent, RuntimeOptions, RuntimeState } from './runtime.types.js';

function attributes<Value extends Subject | AuthorizationEnvironment>(value: Value): Value {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)) {
        throw new AppError('HTTP_CONTEXT_INVALID', 'Subject and environment resolvers must return attribute records.');
    }

    return Object.freeze(snapshotQueryValue(value));
}

export class HonoRuntime<Scope extends InferdiScope = RequestScope> {
    readonly hono: Hono<RuntimeEnv<Scope>>;
    private currentState: RuntimeState = 'created';
    private activeRequests = 0;
    private drain: (() => void) | undefined;
    private readonly disposeRoot: (() => Promise<void>) | undefined;

    constructor(private readonly options: RuntimeOptions<Scope>) {
        options = Object.freeze({ ...options, ...(options.di === undefined ? {} : { di: Object.freeze({ ...options.di }) }) });
        this.options = options;
        const root = createRuntimeContainer(options.application);
        const configured = options.di;
        this.disposeRoot = configured === undefined ? () => root.dispose() : undefined;
        this.hono = new Hono<RuntimeEnv<Scope>>();
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
                const subject = attributes(options.resolveSubject ? await options.resolveSubject(request, bindings) : { anonymous: true });
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

    async start(): Promise<void> {
        if (this.currentState === 'ready') { return; }
        if (this.currentState !== 'created') { throw this.invalidState('start'); }
        this.currentState = 'starting';
        try {
            await this.options.application.start();
            this.currentState = 'ready';
        } catch (error) {
            this.currentState = 'failed';
            try { await this.disposeRoot?.(); }
            catch (cleanupError) { throw new AppError('HTTP_RUNTIME_START_FAILED', 'Runtime startup and cleanup failed.', 500, { cause: new AggregateError([error, cleanupError]) }); }
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
