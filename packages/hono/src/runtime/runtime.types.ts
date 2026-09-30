import type { InferdiRoot, InferdiScope } from '@inferdi/hono';
import type { Application, AuthorizationEnvironment, BoundFeatures, Subject } from '@nestrum/core';
import type { PublicApiOptions } from '#hono/api/api.types';
import type { RequestInputs, RequestScope } from './container.js';

export type RequestContext = Readonly<
    RequestInputs & {
        application: Application;
        databases: Application['databases'];
        resources: Application['resources'];
        authorization: Application['authorization'];
        features: BoundFeatures;
    }
>;

export type RuntimeEnv<Scope extends InferdiScope = RequestScope> = {
    Bindings: Record<string, unknown>;
    Variables: { di: Scope; nestrum: RequestContext };
};
export type RuntimeState = 'created' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed';
export type RuntimeErrorEvent = {
    readonly phase: 'request' | 'scope-dispose';
    readonly request: Request;
    readonly context?: RequestContext;
};
export type AdminUi = {
    readonly basePath: '/admin';
    handle(request: Request, context: { readonly fetch: (request: Request) => Promise<Response> }): Promise<Response>;
};
/**
 * The hosted consumer UI. It is consulted only for GET/HEAD requests no framework or API route matched, so it can
 * never shadow `/api/*`, `/admin/*`, `/__admin/*`, or `/__nestrum/*`. Returning `undefined` yields the normal 404.
 */
export type WebUi = {
    handle(request: Request): Response | undefined | Promise<Response | undefined>;
};
export type RuntimeOptions<Scope extends InferdiScope = RequestScope> = {
    readonly application: Application;
    readonly publicApi?: PublicApiOptions;
    readonly adminUi?: AdminUi;
    readonly webUi?: WebUi;
    readonly di?: {
        readonly container: InferdiRoot;
        readonly createScope: (inputs: RequestInputs) => Scope | Promise<Scope>;
        readonly dispose?: () => void | Promise<void>;
    };
    readonly resolveSubject?: (
        request: Request,
        bindings: Readonly<Record<string, unknown>>,
    ) => Subject | Promise<Subject>;
    readonly resolveEnvironment?: (
        request: Request,
        bindings: Readonly<Record<string, unknown>>,
    ) => AuthorizationEnvironment | Promise<AuthorizationEnvironment>;
    readonly setupScope?: (scope: Scope, context: RequestContext) => void | Promise<void>;
    readonly onError?: (error: unknown, event: RuntimeErrorEvent) => void | Promise<void>;
    readonly stopTraffic?: () => void | Promise<void>;
    readonly drainTimeoutMs?: number;
};
