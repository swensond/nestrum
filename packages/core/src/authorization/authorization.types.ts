import type { FilterExpression } from './filter.js';

export type Subject = Readonly<Record<string, unknown>>;
export type AuthorizationEnvironment = Readonly<Record<string, unknown>>;
export type AuthorizationDecision = { readonly allowed: true } | { readonly allowed: false; readonly reason: string };
export type QueryOperation = 'read' | 'count' | 'create' | 'update' | 'delete';
export type AuthorizationBinding = {
    readonly subject: Subject;
    readonly action: string;
    readonly environment: AuthorizationEnvironment;
};
export type PolicyContext = AuthorizationBinding & {
    readonly identity: string;
    readonly operation?: QueryOperation;
    readonly resource?: Readonly<Record<string, unknown>>;
    readonly input?: Readonly<Record<string, unknown>>;
};
export type PolicyCheck = (context: PolicyContext) => AuthorizationDecision | Promise<AuthorizationDecision>;
export type ActionPolicy = {
    readonly authorize?: PolicyCheck;
    readonly scope?: (context: PolicyContext) => FilterExpression | Promise<FilterExpression>;
    readonly object?: PolicyCheck;
    readonly operations?: readonly QueryOperation[];
};
export type PolicyDefinition = {
    readonly resource: string;
    readonly authorize?: PolicyCheck;
    readonly actions: Readonly<Record<string, ActionPolicy>>;
};
