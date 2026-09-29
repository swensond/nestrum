import type { Application, AuthorizationEnvironment, Subject } from '@nestrum/core';
import type { InferdiRoot, InferdiScope } from '@inferdi/hono';
import type { RequestInputs, RequestScope } from './container.js';
import type { PublicApiOptions } from '#hono/api/api.types';

export type RequestContext = Readonly<RequestInputs & {
    application: Application;
    databases: Application['databases'];
    resources: Application['resources'];
    authorization: Application['authorization'];
}>;

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
export type RuntimeOptions<Scope extends InferdiScope = RequestScope> = {
    readonly application: Application;
    readonly publicApi?: PublicApiOptions;
    readonly di?: {
        readonly container: InferdiRoot;
        readonly createScope: (inputs: RequestInputs) => Scope | Promise<Scope>;
    };
    readonly resolveSubject?: (request: Request, bindings: Readonly<Record<string, unknown>>) => Subject | Promise<Subject>;
    readonly resolveEnvironment?: (request: Request, bindings: Readonly<Record<string, unknown>>) => AuthorizationEnvironment | Promise<AuthorizationEnvironment>;
    readonly setupScope?: (scope: Scope, context: RequestContext) => void | Promise<void>;
    readonly onError?: (error: unknown, event: RuntimeErrorEvent) => void | Promise<void>;
};
