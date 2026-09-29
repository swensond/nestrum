import { AuthorizationError, PolicyError } from './authorization.errors.js';
import type { ActionPolicy, AuthorizationBinding, AuthorizationDecision, PolicyCheck, PolicyContext, PolicyDefinition, QueryOperation } from './authorization.types.js';
import type { FilterExpression } from './filter.js';

export function allow(): AuthorizationDecision { return Object.freeze({ allowed: true }); }
export function deny(reason = 'POLICY_DENIED'): AuthorizationDecision { return Object.freeze({ allowed: false, reason }); }

const QUERY_OPERATIONS: readonly QueryOperation[] = ['read', 'count', 'create', 'update', 'delete'];

export function definePolicy(definition: PolicyDefinition): PolicyDefinition {
    if (!definition || typeof definition.resource !== 'string' || !definition.resource.trim() || definition.resource.trim() !== definition.resource ||
        !definition.actions || typeof definition.actions !== 'object' || Array.isArray(definition.actions) ||
        (definition.authorize !== undefined && typeof definition.authorize !== 'function')) {
        throw new PolicyError('POLICY_INVALID', 'Policies require a resource identity and action map.');
    }
    const actions: Record<string, ActionPolicy> = Object.create(null) as Record<string, ActionPolicy>;
    for (const [name, action] of Object.entries(definition.actions)) {
        if (!name.trim() || name.trim() !== name || !action || typeof action !== 'object' || Array.isArray(action) ||
            ['authorize', 'scope', 'object'].some((key) => key in action && typeof action[key as 'authorize' | 'scope' | 'object'] !== 'function') ||
            (action.operations !== undefined && (!Array.isArray(action.operations) || action.operations.some((operation) => !QUERY_OPERATIONS.includes(operation))))) {
            throw new PolicyError('POLICY_INVALID', `Invalid policy action ${name}.`);
        }
        actions[name] = Object.freeze({
            ...(action.authorize === undefined ? {} : { authorize: action.authorize }),
            ...(action.scope === undefined ? {} : { scope: action.scope }),
            ...(action.object === undefined ? {} : { object: action.object }),
            ...(action.operations === undefined ? {} : { operations: Object.freeze([...action.operations]) })
        });
    }

    return Object.freeze({ resource: definition.resource, ...(definition.authorize === undefined ? {} : { authorize: definition.authorize }), actions: Object.freeze(actions) });
}

async function requireAllow(check: PolicyCheck, context: PolicyContext): Promise<void> {
    const decision = await check(context);
    if (!decision || decision.allowed !== true) {
        throw new AuthorizationError(decision && decision.allowed === false && typeof decision.reason === 'string' ? decision.reason : 'INVALID_DECISION');
    }
}

export type PreparedAuthorization = {
    readonly scope?: FilterExpression;
    checkObject(resource: object): Promise<void>;
};

export class AuthorizationEngine {
    readonly #policies: ReadonlyMap<string, PolicyDefinition>;

    constructor(definitions: readonly PolicyDefinition[] = []) {
        if (!Array.isArray(definitions)) { throw new PolicyError('POLICY_INVALID', 'Policies must be an array.'); }
        const policies = new Map<string, PolicyDefinition>();
        for (const input of definitions) {
            const policy = definePolicy(input);
            if (policies.has(policy.resource)) { throw new PolicyError('POLICY_DUPLICATE', `Duplicate policy for ${policy.resource}.`); }
            policies.set(policy.resource, policy);
        }
        this.#policies = policies;
        Object.freeze(this);
    }

    async prepare(identity: string, binding: AuthorizationBinding, operation?: QueryOperation, input?: object): Promise<PreparedAuthorization> {
        const policy = this.#policies.get(identity);
        if (!policy) { throw new AuthorizationError('POLICY_MISSING'); }
        const action = Object.hasOwn(policy.actions, binding.action) ? policy.actions[binding.action] : undefined;
        if (!action) { throw new AuthorizationError('ACTION_MISSING'); }
        const context: PolicyContext = Object.freeze({ subject: binding.subject, action: binding.action, environment: binding.environment, identity, ...(operation === undefined ? {} : { operation }),
            ...(input === undefined ? {} : { input: input as Readonly<Record<string, unknown>> }) });
        if (policy.authorize) { await requireAllow(policy.authorize, context); }
        if (operation !== undefined) {
            const operations = action.operations ?? (binding.action === 'read' ? ['read', 'count'] : [binding.action]);
            if (!operations.includes(operation)) { throw new AuthorizationError('ACTION_OPERATION_MISMATCH'); }
            if ((operation === 'count' || operation === 'update' || operation === 'delete') && action.object) {
                throw new AuthorizationError('OBJECT_CHECK_REQUIRES_OBJECT');
            }
            if (operation === 'create' && action.scope) { throw new AuthorizationError('CREATE_REQUIRES_EXPLICIT_CHECK'); }
        }
        if (action.authorize) { await requireAllow(action.authorize, context); }
        if (!action.authorize && !action.scope && !action.object) { throw new AuthorizationError('ACTION_HAS_NO_GRANT'); }
        const scope = action.scope ? await action.scope(context) : undefined;
        if (action.scope && (!scope || typeof scope !== 'object')) { throw new PolicyError('POLICY_SCOPE_INVALID', 'Policy scope must return a filter expression.'); }

        return Object.freeze({
            ...(scope === undefined ? {} : { scope }),
            async checkObject(resource: object) {
                const objectContext = Object.freeze({ ...context, resource: resource as Readonly<Record<string, unknown>> });
                if (action.object) { await requireAllow(action.object, objectContext); }
            }
        });
    }

    async authorize(context: PolicyContext): Promise<AuthorizationDecision> {
        try {
            const prepared = await this.prepare(context.identity, context, context.operation, context.input);
            if (prepared.scope) { throw new AuthorizationError('SCOPE_REQUIRES_QUERY'); }
            if (context.resource) { await prepared.checkObject(context.resource); }
            else {
                const action = this.#policies.get(context.identity)!.actions[context.action]!;
                if (action.object || action.scope) { throw new AuthorizationError('RESOURCE_REQUIRED'); }
            }

            return allow();
        } catch (error) {
            if (error instanceof AuthorizationError) { return deny(error.reason); }
            throw error;
        }
    }
}
