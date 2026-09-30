import { AppError } from '#core/application/application.errors';
import type { FeatureFlagDefinition, FeatureFlagDefinitions, FeatureFlags, FeatureHandle } from './features.types.js';

/** Flag names are identifiers so they are safe as property names, admin URLs and storage keys. */
export const FEATURE_NAME = /^[a-z][A-Za-z0-9]{0,63}$/;
const RESERVED = new Set(['registry', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty']);

export class FeatureError extends AppError {
    constructor(code: string, message: string, status = 500) {
        super(code, message, status);
        this.name = 'FeatureError';
    }
}

/** Immutable, source-owned flag declarations. */
export class FeatureRegistry<Name extends string = string> {
    private readonly definitions: ReadonlyMap<string, Readonly<FeatureFlagDefinition>>;

    constructor(definitions: FeatureFlagDefinitions) {
        if (!definitions || typeof definitions !== 'object' || Array.isArray(definitions)) {
            throw new FeatureError('FEATURE_CONFIG_INVALID', 'Feature flags must be declared as a record.');
        }
        const map = new Map<string, Readonly<FeatureFlagDefinition>>();
        for (const [name, definition] of Object.entries(definitions)) {
            if (!FEATURE_NAME.test(name) || RESERVED.has(name)) {
                throw new FeatureError(
                    'FEATURE_NAME_INVALID',
                    `Feature flag "${name}" must be a camelCase identifier of at most 64 characters.`,
                );
            }
            if (
                !definition ||
                typeof definition !== 'object' ||
                typeof definition.default !== 'boolean' ||
                (definition.exposeToClient !== undefined && typeof definition.exposeToClient !== 'boolean') ||
                (definition.description !== undefined &&
                    (typeof definition.description !== 'string' || definition.description.length > 280))
            ) {
                throw new FeatureError(
                    'FEATURE_DEFINITION_INVALID',
                    `Feature flag "${name}" needs a boolean default; exposeToClient must be boolean.`,
                );
            }
            map.set(name, Object.freeze({ ...definition }));
        }
        this.definitions = map;
    }

    names(): Name[] {
        return [...this.definitions.keys()] as Name[];
    }

    has(name: string): name is Name {
        return this.definitions.has(name);
    }

    get(name: string): Readonly<FeatureFlagDefinition> {
        const definition = this.definitions.get(name);
        if (definition === undefined) {
            throw new FeatureError('FEATURE_UNKNOWN', `Feature flag "${name}" is not declared.`, 404);
        }

        return definition;
    }

    /** Names of flags that may be sent to the consumer UI. */
    exposed(): Name[] {
        return this.names().filter((name) => this.definitions.get(name)?.exposeToClient === true);
    }
}

/** Combine several registries (for example, one per app); duplicate names are rejected. */
export function mergeFeatureDefinitions(...sets: readonly FeatureFlagDefinitions[]): FeatureFlagDefinitions {
    const merged: Record<string, FeatureFlagDefinition> = {};
    for (const set of sets) {
        for (const [name, definition] of Object.entries(set)) {
            if (Object.hasOwn(merged, name)) {
                throw new FeatureError('FEATURE_DUPLICATE', `Feature flag "${name}" is declared twice.`);
            }
            merged[name] = definition;
        }
    }

    return merged;
}

/** Late-bound evaluation entry, wired to the application's evaluator when it starts. */
export type FeatureBinding = {
    enabled(name: string, context?: import('./features.types.js').FeatureContext): Promise<boolean>;
    evaluate(
        name: string,
        context?: import('./features.types.js').FeatureContext,
    ): Promise<import('./features.types.js').FeatureEvaluation>;
};

const bindings = new WeakMap<object, { current: FeatureBinding | undefined }>();

export function currentFeatureBinding(flags: object): FeatureBinding | undefined {
    return bindings.get(flags)?.current;
}

/** Attach the evaluator that backs a `defineFeatureFlags` object's handles (done by the application at start). */
export function bindFeatureFlags(flags: object, binding: FeatureBinding | undefined): void {
    const slot = bindings.get(flags);
    if (!slot) {
        throw new FeatureError('FEATURE_CONFIG_INVALID', 'Not a defineFeatureFlags result.');
    }
    slot.current = binding;
}

/**
 * Declare strongly typed boolean flags:
 *
 * ```ts
 * export const features = defineFeatureFlags({ newDashboard: { default: false } });
 * await features.newDashboard.enabled({ subject });
 * ```
 *
 * The result evaluates through the application it is registered with (`defineFeatures({ flags: features })`).
 */
export function defineFeatureFlags<const Definitions extends FeatureFlagDefinitions>(
    definitions: Definitions,
): FeatureFlags<Definitions> {
    const registry = new FeatureRegistry<keyof Definitions & string>(definitions);
    const slot: { current: FeatureBinding | undefined } = { current: undefined };
    const handles: Record<string, FeatureHandle | FeatureRegistry> = {};
    const active = (): FeatureBinding => {
        if (!slot.current) {
            throw new FeatureError(
                'FEATURES_NOT_READY',
                'Feature flags evaluate after the application that registers them has started.',
            );
        }

        return slot.current;
    };
    for (const name of registry.names()) {
        handles[name] = Object.freeze({
            name,
            enabled: async (context) => active().enabled(name, context),
            evaluate: async (context) => active().evaluate(name, context),
        } satisfies FeatureHandle);
    }
    handles.registry = registry;
    const flags = Object.freeze(handles) as unknown as FeatureFlags<Definitions>;
    bindings.set(flags, slot);

    return flags;
}
