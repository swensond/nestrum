import type { ScopeInputMap, Spec, WithRequirements } from '@inferdi/inferdi';
import { Container } from '@inferdi/inferdi';
import type { Application, AuthorizationEnvironment, BoundFeatures, Subject } from '@nestrum/core';
import { FeatureError } from '@nestrum/core';

export type RequestInputs = { subject: Subject; environment: AuthorizationEnvironment; request: Request };

export type RuntimeGraph = {
    application: Spec<Application>;
    database: Spec<Application['database']>;
    resources: Spec<Application['resources']>;
    authorization: Spec<Application['authorization']>;
    features: Spec<BoundFeatures, 'scoped'>;
} & ScopeInputMap<RequestInputs>;
export type RuntimeContainer = Container<RuntimeGraph>;
export type RequestScope = Container<{ [Key in keyof RuntimeGraph]: WithRequirements<RuntimeGraph[Key], never> }>;

/** Feature evaluation bound to a request's trusted subject and environment; it never authorizes anything. */
export function requestFeatures(application: Application, inputs: Omit<RequestInputs, 'request'>): BoundFeatures {
    const features = application.features;
    if (!features) {
        const missing = async (): Promise<never> => {
            throw new FeatureError('FEATURES_NOT_CONFIGURED', 'Feature flags are not configured for this application.');
        };

        return { enabled: missing, evaluate: missing, exposed: missing };
    }

    return features.forRequest(inputs);
}

export function createRuntimeContainer(application: Application): RuntimeContainer {
    return new Container()
        .registerValue('application', application)
        .registerValue('database', application.database)
        .registerValue('resources', application.resources)
        .registerValue('authorization', application.authorization)
        .declareScopeInputs<RequestInputs>()
        .registerFactory(
            'features',
            (scope) =>
                requestFeatures(application, { subject: scope.get('subject'), environment: scope.get('environment') }),
            ['subject', 'environment'],
            'scoped',
        );
}

export function openRequestScope(container: RuntimeContainer, inputs: RequestInputs): RequestScope {
    return container.createScope(inputs);
}
