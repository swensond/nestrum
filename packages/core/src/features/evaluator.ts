import type {
    FeatureChangeListener,
    FeatureContext,
    FeatureEvaluation,
    FeatureEvaluatorApi,
    FeatureManagerApi,
    FeatureRule,
    FeatureRuleInput,
    FeatureRuleScope,
    FeatureStore,
} from './features.types.js';
import { FEATURE_RULE_SCOPES } from './features.types.js';
import { rolloutBucket } from './hash.js';
import { FeatureError, type FeatureRegistry } from './registry.js';

export type FeatureEvaluatorOptions = {
    readonly registry: FeatureRegistry;
    readonly store: FeatureStore;
    /** Deployment environment name used when a context carries none. */
    readonly environment?: string;
    /** In-process overrides (development or tests); they win over every stored rule and never touch the store. */
    readonly overrides?: Readonly<Record<string, boolean>>;
    /** Rule cache lifetime in milliseconds. `0` (default) reads the store on every evaluation. */
    readonly cacheTtlMs?: number;
    /** Receives store failures. The evaluation itself falls back to the declared default. */
    readonly onError?: (error: unknown) => void | Promise<void>;
    readonly clock?: () => number;
};

function stableKey(context: FeatureContext): string | undefined {
    const candidate = context.stableId ?? context.subject?.id;

    return typeof candidate === 'string' && candidate !== '' && candidate.length <= 256 ? candidate : undefined;
}

/**
 * Deterministic boolean evaluation. Precedence, first match wins:
 * override, subject, organization, percentage, environment, global, declared default.
 * Missing context safely skips the layers it would need; nothing here consults ABAC or randomness.
 */
export class FeatureEvaluator implements FeatureEvaluatorApi {
    private cache: { readonly loadedAt: number; readonly rules: readonly FeatureRule[] } | undefined;
    private loading: Promise<readonly FeatureRule[]> | undefined;
    private generation = 0;
    private readonly overrides: ReadonlyMap<string, boolean>;

    constructor(private readonly options: FeatureEvaluatorOptions) {
        const overrides = new Map<string, boolean>();
        for (const [name, value] of Object.entries(options.overrides ?? {})) {
            options.registry.get(name);
            if (typeof value !== 'boolean') {
                throw new FeatureError('FEATURE_OVERRIDE_INVALID', `Override for "${name}" must be a boolean.`);
            }
            overrides.set(name, value);
        }
        this.overrides = overrides;
        const ttl = options.cacheTtlMs ?? 0;
        if (!Number.isFinite(ttl) || ttl < 0) {
            throw new FeatureError('FEATURE_CONFIG_INVALID', 'cacheTtlMs must be a non-negative number.');
        }
    }

    withOverrides(overrides: Readonly<Record<string, boolean>>): FeatureEvaluator {
        return new FeatureEvaluator({
            ...this.options,
            overrides: { ...Object.fromEntries(this.overrides), ...overrides },
        });
    }

    invalidate(): void {
        this.generation += 1;
        this.cache = undefined;
        this.loading = undefined;
    }

    private async rules(): Promise<readonly FeatureRule[]> {
        const ttl = this.options.cacheTtlMs ?? 0;
        const now = (this.options.clock ?? Date.now)();
        if (ttl > 0 && this.cache && now - this.cache.loadedAt < ttl) {
            return this.cache.rules;
        }
        if (ttl > 0 && this.loading) {
            return this.loading;
        }
        const generation = this.generation;
        const load = this.options.store.list().then((rules) => {
            if (ttl > 0 && generation === this.generation) {
                this.cache = { loadedAt: now, rules };
            }

            return rules;
        });
        if (ttl > 0) {
            this.loading = load;
            load.then(
                () => {
                    if (generation === this.generation) {
                        this.loading = undefined;
                    }
                },
                () => {
                    if (generation === this.generation) {
                        this.loading = undefined;
                    }
                },
            );
        }

        return load;
    }

    async evaluate(flag: string, context: FeatureContext = {}): Promise<FeatureEvaluation> {
        const definition = this.options.registry.get(flag);
        const override = this.overrides.get(flag);
        if (override !== undefined) {
            return Object.freeze({ flag, enabled: override, reason: Object.freeze({ source: 'override' as const }) });
        }
        let rules: readonly FeatureRule[];
        try {
            rules = await this.rules();
        } catch (error) {
            try {
                await this.options.onError?.(error);
            } catch {
                /* Observers cannot change the outcome. */
            }

            return Object.freeze({
                flag,
                enabled: definition.default,
                reason: Object.freeze({ source: 'default' as const, degraded: true as const }),
            });
        }
        const own = rules.filter((rule) => rule.flag === flag);
        const find = (scope: FeatureRuleScope, target: string) =>
            own.find((rule) => rule.scope === scope && rule.target === target);
        const decide = (enabled: boolean, reason: FeatureEvaluation['reason']): FeatureEvaluation =>
            Object.freeze({ flag, enabled, reason: Object.freeze(reason) });
        const key = stableKey(context);
        if (key !== undefined) {
            const rule = find('subject', key);
            if (rule) {
                return decide(rule.enabled, { source: 'subject', target: key });
            }
        }
        if (context.organizationId !== undefined) {
            const rule = find('organization', context.organizationId);
            if (rule) {
                return decide(rule.enabled, { source: 'organization', target: context.organizationId });
            }
        }
        const rollout = find('percentage', '');
        if (rollout && rollout.percentage !== null && key !== undefined) {
            const bucket = rolloutBucket(flag, key);
            if (bucket < Math.round(rollout.percentage * 100)) {
                return decide(true, { source: 'percentage', percentage: rollout.percentage, bucket });
            }
        }
        const environment = context.environment ?? this.options.environment;
        if (environment !== undefined) {
            const rule = find('environment', environment);
            if (rule) {
                return decide(rule.enabled, { source: 'environment', target: environment });
            }
        }
        const global = find('global', '');
        if (global) {
            return decide(global.enabled, { source: 'global' });
        }

        return decide(definition.default, { source: 'default' });
    }

    async enabled(flag: string, context?: FeatureContext): Promise<boolean> {
        return (await this.evaluate(flag, context)).enabled;
    }

    async exposed(context?: FeatureContext): Promise<Readonly<Record<string, boolean>>> {
        const names = this.options.registry.exposed();
        const values = await Promise.all(names.map((name) => this.enabled(name, context)));

        return Object.freeze(Object.fromEntries(names.map((name, index) => [name, values[index] as boolean])));
    }
}

export type FeatureManagerOptions = {
    readonly registry: FeatureRegistry;
    readonly store: FeatureStore;
    readonly evaluator: FeatureEvaluatorApi;
    readonly listeners?: readonly FeatureChangeListener[];
    readonly onError?: (error: unknown) => void | Promise<void>;
};

const TARGET = /^[\x21-\x7e]{1,256}$/;

export function validateRuleInput(
    registry: FeatureRegistry,
    input: FeatureRuleInput,
): Required<Pick<FeatureRule, 'flag' | 'scope' | 'target' | 'enabled'>> & { readonly percentage: number | null } {
    registry.get(input.flag);
    if (!(FEATURE_RULE_SCOPES as readonly string[]).includes(input.scope)) {
        throw new FeatureError('FEATURE_RULE_INVALID', 'Unknown feature rule scope.', 400);
    }
    const target = input.target ?? '';
    if (input.scope === 'global' || input.scope === 'percentage') {
        if (target !== '') {
            throw new FeatureError('FEATURE_RULE_INVALID', `A ${input.scope} rule has no target.`, 400);
        }
    } else if (!TARGET.test(target)) {
        throw new FeatureError(
            'FEATURE_RULE_INVALID',
            'Subject, organization and environment rules need a printable target of at most 256 characters.',
            400,
        );
    }
    if (input.scope === 'percentage') {
        const percentage = input.percentage;
        if (
            typeof percentage !== 'number' ||
            !Number.isFinite(percentage) ||
            percentage < 0 ||
            percentage > 100 ||
            Math.round(percentage * 100) / 100 !== percentage
        ) {
            throw new FeatureError(
                'FEATURE_RULE_INVALID',
                'A rollout percentage must be between 0 and 100 with at most two decimals.',
                400,
            );
        }

        return { flag: input.flag, scope: 'percentage', target: '', enabled: true, percentage };
    }
    if (input.percentage !== undefined) {
        throw new FeatureError('FEATURE_RULE_INVALID', 'Only percentage rules carry a percentage.', 400);
    }
    if (typeof input.enabled !== 'boolean') {
        throw new FeatureError('FEATURE_RULE_INVALID', 'A rule needs a boolean enabled value.', 400);
    }

    return { flag: input.flag, scope: input.scope, target, enabled: input.enabled, percentage: null };
}

/** Writes overrides, invalidates evaluation state, and emits the audit/event seam. */
export class FeatureManager implements FeatureManagerApi {
    constructor(private readonly options: FeatureManagerOptions) {}

    list(flag?: string): Promise<readonly FeatureRule[]> {
        if (flag !== undefined) {
            this.options.registry.get(flag);
        }

        return this.options.store.list(flag);
    }

    async set(input: FeatureRuleInput, actor?: string): Promise<FeatureRule> {
        const valid = validateRuleInput(this.options.registry, input);
        const rule = await this.options.store.upsert({ ...valid, updatedBy: actor ?? null });
        this.options.evaluator.invalidate();
        await this.emit({
            type: 'set',
            flag: rule.flag,
            scope: rule.scope,
            target: rule.target,
            enabled: rule.scope === 'percentage' ? null : rule.enabled,
            percentage: rule.percentage,
            actor: actor ?? null,
        });

        return rule;
    }

    async remove(flag: string, scope: FeatureRuleScope, target = '', actor?: string): Promise<boolean> {
        validateRuleInput(this.options.registry, {
            flag,
            scope,
            target,
            ...(scope === 'percentage' ? { percentage: 0 } : { enabled: false }),
        });
        const removed = await this.options.store.remove(flag, scope, target);
        this.options.evaluator.invalidate();
        if (removed) {
            await this.emit({
                type: 'remove',
                flag,
                scope,
                target,
                enabled: null,
                percentage: null,
                actor: actor ?? null,
            });
        }

        return removed;
    }

    /** Listener failures are reported but never undo an already-persisted change. */
    private async emit(event: Omit<Parameters<FeatureChangeListener>[0], 'at'>): Promise<void> {
        const full = Object.freeze({ ...event, at: new Date().toISOString() });
        for (const listener of this.options.listeners ?? []) {
            try {
                await listener(full);
            } catch (error) {
                try {
                    await this.options.onError?.(error);
                } catch {
                    /* Observers cannot fail a completed change. */
                }
            }
        }
    }
}
