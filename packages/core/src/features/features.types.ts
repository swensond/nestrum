import type { Application } from '#core/application/application';
import type { AppDefinition } from '#core/application/application.types';
import type { AuthorizationEnvironment, Subject } from '#core/authorization/authorization.types';
import type { ModelIdentity, PrismaProvider } from '#core/database/database.types';
import type { FeatureRegistry } from './registry.js';

/** A flag as declared in source. Values are boolean only; the default is the deployable fallback. */
export type FeatureFlagDefinition = {
    readonly default: boolean;
    readonly description?: string;
    /** Only flags marked `exposeToClient: true` may reach the hosted consumer UI, as an evaluated boolean. */
    readonly exposeToClient?: boolean;
};
export type FeatureFlagDefinitions = Readonly<Record<string, FeatureFlagDefinition>>;

/**
 * What is known about the evaluation. Every field is trusted, framework/application-provided input, never a client
 * claim. `attributes` is carried for application code and diagnostics; targeting never reads it.
 */
export type FeatureContext = {
    readonly subject?: Subject;
    /** Stable identifier for rollouts; defaults to `subject.id`. Required to roll out to anonymous actors. */
    readonly stableId?: string;
    readonly organizationId?: string;
    /** Deployment environment name (e.g. `production`); defaults to the evaluator's environment. */
    readonly environment?: string;
    readonly attributes?: Readonly<Record<string, unknown>>;
};

/** Where a stored rule applies. Precedence is subject, organization, percentage, environment, global, default. */
export const FEATURE_RULE_SCOPES = ['subject', 'organization', 'percentage', 'environment', 'global'] as const;
export type FeatureRuleScope = (typeof FEATURE_RULE_SCOPES)[number];

export type FeatureRule = {
    readonly id: string;
    readonly flag: string;
    readonly scope: FeatureRuleScope;
    /** Subject key, organization ID, or environment name; `''` for `global` and `percentage`. */
    readonly target: string;
    readonly enabled: boolean;
    /** Only for `percentage` rules: 0-100, at most two decimals. Subjects inside the bucket get the flag on. */
    readonly percentage: number | null;
    readonly updatedBy: string | null;
    readonly updatedAt: string;
};

export type FeatureRuleInput = {
    readonly flag: string;
    readonly scope: FeatureRuleScope;
    readonly target?: string;
    readonly enabled?: boolean;
    readonly percentage?: number;
};

/** Persistence for overrides. Implementations must treat `(flag, scope, target)` as a unique key. */
export interface FeatureStore {
    list(flag?: string): Promise<readonly FeatureRule[]>;
    upsert(
        input: Required<Pick<FeatureRule, 'flag' | 'scope' | 'target' | 'enabled'>> & {
            readonly percentage: number | null;
            readonly updatedBy: string | null;
        },
    ): Promise<FeatureRule>;
    /** Removes one rule; returns whether it existed. */
    remove(flag: string, scope: FeatureRuleScope, target: string): Promise<boolean>;
}

/** Why a flag has its value. Never contains context attributes or other rules. */
export type FeatureReason =
    | { readonly source: 'override' }
    | { readonly source: 'subject' | 'organization' | 'environment'; readonly target: string }
    | { readonly source: 'percentage'; readonly percentage: number; readonly bucket: number }
    | { readonly source: 'global' }
    | { readonly source: 'default'; readonly degraded?: true };
export type FeatureEvaluation = {
    readonly flag: string;
    readonly enabled: boolean;
    readonly reason: FeatureReason;
};

export type FeatureChangeEvent = {
    readonly type: 'set' | 'remove';
    readonly flag: string;
    readonly scope: FeatureRuleScope;
    readonly target: string;
    readonly enabled: boolean | null;
    readonly percentage: number | null;
    readonly actor: string | null;
    readonly at: string;
};
export type FeatureChangeListener = (event: FeatureChangeEvent) => void | Promise<void>;

/** Request-bound evaluation: the context is already filled from the trusted request. */
export type BoundFeatures<Name extends string = string> = {
    enabled(flag: Name, context?: FeatureContext): Promise<boolean>;
    evaluate(flag: Name, context?: FeatureContext): Promise<FeatureEvaluation>;
    /** Evaluated booleans of every `exposeToClient` flag; nothing else. */
    exposed(context?: FeatureContext): Promise<Readonly<Record<string, boolean>>>;
};

export type FeatureHandle = {
    readonly name: string;
    enabled(context?: FeatureContext): Promise<boolean>;
    evaluate(context?: FeatureContext): Promise<FeatureEvaluation>;
};
export type FeatureFlags<Definitions extends FeatureFlagDefinitions = FeatureFlagDefinitions> = {
    readonly [Name in keyof Definitions & string]: FeatureHandle;
} & { readonly registry: FeatureRegistry<keyof Definitions & string> };

/** Application-level runtime, available as `application.features` once started. */
export type Features = {
    readonly registry: FeatureRegistry;
    readonly evaluator: FeatureEvaluatorApi;
    readonly manager: FeatureManagerApi;
    /** Bind evaluation to a trusted request subject/environment. */
    forRequest(input: { readonly subject: Subject; readonly environment: AuthorizationEnvironment }): BoundFeatures;
};
export type FeatureEvaluatorApi = {
    enabled(flag: string, context?: FeatureContext): Promise<boolean>;
    evaluate(flag: string, context?: FeatureContext): Promise<FeatureEvaluation>;
    exposed(context?: FeatureContext): Promise<Readonly<Record<string, boolean>>>;
    /** Drop any cached rules. Writes through the manager already do this. */
    invalidate(): void;
    /** A derived evaluator whose in-process overrides win over every stored rule; the original is unaffected. */
    withOverrides(overrides: Readonly<Record<string, boolean>>): FeatureEvaluatorApi;
};
export type FeatureManagerApi = {
    list(flag?: string): Promise<readonly FeatureRule[]>;
    set(input: FeatureRuleInput, actor?: string): Promise<FeatureRule>;
    remove(flag: string, scope: FeatureRuleScope, target?: string, actor?: string): Promise<boolean>;
};

export type FeaturesDefinition = {
    readonly kind: 'nestrum-features';
    /** Database storing overrides; `undefined` means in-memory (non-persistent) storage. */
    readonly database: string | undefined;
    readonly protectedModels: readonly ModelIdentity[];
    createApp(provider: PrismaProvider): AppDefinition;
    initialize(application: Application): Promise<Features>;
};
