import type { ScopeInputMap, Spec, WithRequirements } from '@inferdi/inferdi';
import { Container } from '@inferdi/inferdi';
import type { Application, AuthorizationEnvironment, Subject } from '@nestrum/core';

export type RequestInputs = { subject: Subject; environment: AuthorizationEnvironment; request: Request };

export type RuntimeGraph = {
    application: Spec<Application>;
    databases: Spec<Application['databases']>;
    resources: Spec<Application['resources']>;
    authorization: Spec<Application['authorization']>;
} & ScopeInputMap<RequestInputs>;
export type RuntimeContainer = Container<RuntimeGraph>;
export type RequestScope = Container<{ [Key in keyof RuntimeGraph]: WithRequirements<RuntimeGraph[Key], never> }>;

export function createRuntimeContainer(application: Application): RuntimeContainer {
    return new Container()
        .registerValue('application', application)
        .registerValue('databases', application.databases)
        .registerValue('resources', application.resources)
        .registerValue('authorization', application.authorization)
        .declareScopeInputs<RequestInputs>();
}

export function openRequestScope(container: RuntimeContainer, inputs: RequestInputs): RequestScope {
    return container.createScope(inputs);
}
