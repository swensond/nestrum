import type {
    Application,
    DatabaseDefinition,
    FeatureChangeListener,
    FeatureStore,
    Features,
    FeaturesDefinition,
} from '@nestrum/core';
import {
    AppError,
    bindFeatureFlags,
    createFeatures,
    defineApp,
    FeatureError,
    FeatureRegistry,
    MemoryFeatureStore,
    modelIdentity,
} from '@nestrum/core';
import type { PrismaQueryBackendOptions } from '@nestrum/prisma/querysets';
import { createPrismaQueryBackend } from '@nestrum/prisma/querysets';
import { FEATURE_MODELS, featureContract } from '#features/contract';
import { createPrismaFeatureStore } from '#features/prisma-store';

export type FeaturePrismaBinding = {
    readonly database: string;
    /** The `FeatureOverride` collection of the selected database's Prisma client. */
    readonly collection: Parameters<typeof createPrismaQueryBackend>[0];
    /** MongoDB only: the count callback the Prisma query backend needs. Feature storage itself never counts. */
    readonly count?: Extract<PrismaQueryBackendOptions, { provider: 'mongodb' }>['count'];
};

export type FeaturesConfig = {
    /** The declared flags. Their handles evaluate through this application once it has started. */
    readonly flags: { readonly registry: FeatureRegistry };
    /** Database storing overrides. Omit (with no `prisma`) for non-persistent, in-memory overrides. */
    readonly database?: string;
    readonly prisma?: (context: {
        readonly database: string;
        readonly definition: DatabaseDefinition;
        readonly application: Application;
    }) => FeaturePrismaBinding | Promise<FeaturePrismaBinding>;
    /** Deployment environment name, matched by `environment` rules (for example `production`). */
    readonly environment?: string;
    /** Milliseconds to cache stored rules. Default 0: every evaluation reads storage, so changes apply immediately. */
    readonly cacheTtlMs?: number;
    /** Process-local overrides that never touch storage. `nestrum dev --feature name=value` supplies these too. */
    readonly overrides?: Readonly<Record<string, boolean>>;
    /** Audit/event seam: called after every persisted change to an override. */
    readonly onChange?: readonly FeatureChangeListener[];
    readonly onError?: (error: unknown) => void | Promise<void>;
};

/** Development overrides handed over by `nestrum dev --feature`. Honored only when `NESTRUM_ENV` is `development`. */
export const DEV_OVERRIDES_ENV = 'NESTRUM_DEV_FEATURES';

export function parseDevOverrides(raw: string | undefined): Record<string, boolean> {
    if (raw === undefined || raw === '') {
        return {};
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new FeatureError('FEATURE_OVERRIDE_INVALID', `${DEV_OVERRIDES_ENV} must be a JSON object of booleans.`);
    }
    if (
        !parsed ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed) ||
        Object.values(parsed).some((value) => typeof value !== 'boolean')
    ) {
        throw new FeatureError('FEATURE_OVERRIDE_INVALID', `${DEV_OVERRIDES_ENV} must be a JSON object of booleans.`);
    }

    return { ...(parsed as Record<string, boolean>) };
}

function developmentOverrides(): Record<string, boolean> {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;

    // `nestrum dev` sets both; `nestrum serve` pins NESTRUM_ENV to production, so a stray variable there is ignored.
    return env?.NESTRUM_ENV === 'development' ? parseDevOverrides(env[DEV_OVERRIDES_ENV]) : {};
}

/**
 * Configure feature flags for `defineApplication({ features })`. With a `database` and `prisma` binding, overrides
 * persist in Nestrum's `FeatureOverride` model; otherwise they live in memory. Source defaults are always the
 * fallback, including when storage fails.
 */
export function defineFeatures(config: FeaturesConfig): FeaturesDefinition {
    const registry = config?.flags?.registry;
    if (!(registry instanceof FeatureRegistry)) {
        throw new FeatureError('FEATURE_CONFIG_INVALID', 'defineFeatures requires flags from defineFeatureFlags().');
    }
    if ((config.database === undefined) !== (config.prisma === undefined)) {
        throw new FeatureError(
            'FEATURE_CONFIG_INVALID',
            'Persistent features need both a database name and a prisma binding.',
        );
    }
    if (config.prisma !== undefined && typeof config.prisma !== 'function') {
        throw new FeatureError('FEATURE_CONFIG_INVALID', 'features.prisma must be a function.');
    }
    if (
        config.environment !== undefined &&
        (typeof config.environment !== 'string' || !/^[\x21-\x7e]{1,64}$/.test(config.environment))
    ) {
        throw new FeatureError('FEATURE_CONFIG_INVALID', 'features.environment must be a short printable name.');
    }
    const { database, flags } = config;
    const protectedModels = Object.freeze(
        database === undefined ? [] : FEATURE_MODELS.map((model) => modelIdentity(model, database)),
    );
    const overrides = { ...(config.overrides ?? {}), ...developmentOverrides() };
    for (const name of Object.keys(overrides)) {
        registry.get(name);
    }

    return Object.freeze({
        kind: 'nestrum-features' as const,
        database,
        protectedModels,
        createApp: (provider) =>
            defineApp({
                name: 'nestrum.features',
                prismaSource: { [database as string]: featureContract(provider) },
                shutdown: () => bindFeatureFlags(flags, undefined),
            }),
        async initialize(application: Application): Promise<Features> {
            let store: FeatureStore = new MemoryFeatureStore();
            if (database !== undefined && config.prisma !== undefined) {
                const definition = application.databases.get(database);
                const binding = await config.prisma({ application, database, definition });
                if (binding.database !== database) {
                    throw new AppError(
                        'FEATURES_DATABASE_MISMATCH',
                        'Feature storage must bind its selected database.',
                    );
                }
                store = createPrismaFeatureStore(
                    createPrismaQueryBackend(
                        binding.collection,
                        definition.provider === 'postgresql'
                            ? { provider: 'postgresql' }
                            : {
                                  provider: 'mongodb',
                                  count:
                                      binding.count ??
                                      (async () => {
                                          throw new AppError(
                                              'FEATURE_STORAGE_INVALID',
                                              'Feature storage does not count records.',
                                          );
                                      }),
                              },
                    ),
                    definition.provider,
                );
            }
            const features = createFeatures({
                registry,
                store,
                overrides,
                ...(config.environment === undefined ? {} : { environment: config.environment }),
                ...(config.cacheTtlMs === undefined ? {} : { cacheTtlMs: config.cacheTtlMs }),
                ...(config.onChange === undefined ? {} : { onChange: config.onChange }),
                ...(config.onError === undefined ? {} : { onError: config.onError }),
            });
            bindFeatureFlags(flags, {
                enabled: (name, context) => features.evaluator.enabled(name, context),
                evaluate: (name, context) => features.evaluator.evaluate(name, context),
            });

            return features;
        },
    });
}
