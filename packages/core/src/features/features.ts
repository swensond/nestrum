import type { AuthorizationEnvironment, Subject } from '#core/authorization/authorization.types';
import type { FeatureEvaluatorOptions } from './evaluator.js';
import { FeatureEvaluator, FeatureManager } from './evaluator.js';
import type {
    BoundFeatures,
    FeatureChangeListener,
    FeatureContext,
    FeatureFlagDefinitions,
    FeatureFlags,
    FeatureStore,
    Features,
} from './features.types.js';
import { MemoryFeatureStore } from './memory-store.js';
import type { FeatureBinding } from './registry.js';
import { bindFeatureFlags, currentFeatureBinding, FeatureError, FeatureRegistry } from './registry.js';

export type CreateFeaturesOptions = {
    readonly registry: FeatureRegistry;
    readonly store?: FeatureStore;
    readonly environment?: string;
    readonly overrides?: Readonly<Record<string, boolean>>;
    readonly cacheTtlMs?: number;
    readonly onChange?: readonly FeatureChangeListener[];
    readonly onError?: FeatureEvaluatorOptions['onError'];
};

/**
 * Trusted request inputs become an evaluation context. The organization comes from the resolved subject or the
 * application-resolved environment; the anonymous rollout identifier from `environment.featureKey`. Nothing is read
 * from headers, cookies or query strings.
 */
export function requestFeatureContext(subject: Subject, environment: AuthorizationEnvironment): FeatureContext {
    const organization = subject.organizationId ?? environment.organizationId;
    const stableId = environment.featureKey;

    return {
        subject,
        ...(typeof organization === 'string' ? { organizationId: organization } : {}),
        ...(typeof stableId === 'string' ? { stableId } : {}),
    };
}

export function createFeatures(options: CreateFeaturesOptions): Features {
    if (!(options.registry instanceof FeatureRegistry)) {
        throw new FeatureError('FEATURE_CONFIG_INVALID', 'Features require a FeatureRegistry.');
    }
    const store = options.store ?? new MemoryFeatureStore();
    const evaluator = new FeatureEvaluator({
        registry: options.registry,
        store,
        ...(options.environment === undefined ? {} : { environment: options.environment }),
        ...(options.overrides === undefined ? {} : { overrides: options.overrides }),
        ...(options.cacheTtlMs === undefined ? {} : { cacheTtlMs: options.cacheTtlMs }),
        ...(options.onError === undefined ? {} : { onError: options.onError }),
    });
    const manager = new FeatureManager({
        registry: options.registry,
        store,
        evaluator,
        ...(options.onChange === undefined ? {} : { listeners: options.onChange }),
        ...(options.onError === undefined ? {} : { onError: options.onError }),
    });

    return Object.freeze({
        registry: options.registry,
        evaluator,
        manager,
        forRequest({ subject, environment }): BoundFeatures {
            const base = requestFeatureContext(subject, environment);
            const merge = (context?: FeatureContext): FeatureContext => ({ ...base, ...context });

            return Object.freeze({
                enabled: (flag, context) => evaluator.enabled(flag, merge(context)),
                evaluate: (flag, context) => evaluator.evaluate(flag, merge(context)),
                exposed: (context) => evaluator.exposed(merge(context)),
            });
        },
    });
}

/**
 * Test helper: run `callback` with `flags` handles evaluating from a fresh in-memory evaluator where `overrides` win.
 * Nothing shared (stores, the real application evaluator) is touched, and the previous binding is restored even when
 * the callback throws. The binding is process-wide for the callback, so run such tests serially.
 */
export async function withFeatureFlags<Definitions extends FeatureFlagDefinitions, T>(
    flags: FeatureFlags<Definitions>,
    overrides: Readonly<Partial<Record<keyof Definitions & string, boolean>>>,
    callback: () => Promise<T> | T,
): Promise<T> {
    const evaluator = new FeatureEvaluator({
        registry: flags.registry,
        store: new MemoryFeatureStore(),
        overrides: overrides as Readonly<Record<string, boolean>>,
    });
    const previous = currentFeatureBinding(flags);
    bindFeatureFlags(flags, {
        enabled: (name, context) => evaluator.enabled(name, context),
        evaluate: (name, context) => evaluator.evaluate(name, context),
    } satisfies FeatureBinding);
    try {
        return await callback();
    } finally {
        bindFeatureFlags(flags, previous);
    }
}
