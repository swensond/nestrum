import type { Application } from '#core/application/application';
import type { AuthorizationEnvironment, Subject } from '#core/authorization/authorization.types';
import type { ResourceConfig } from '#core/resource/resource.types';

export type AdminFieldConfiguration = {
    readonly label?: string;
    readonly hidden?: boolean;
    readonly readOnly?: boolean;
};
export type AdminActionConfiguration = {
    readonly label?: string;
};
export type AdminResourceConfiguration = {
    readonly listDisplay: readonly string[];
    readonly fields?: Readonly<Record<string, AdminFieldConfiguration>>;
    readonly actions?: Readonly<Record<string, AdminActionConfiguration>>;
};
export type AdminResourceRegistration = {
    readonly resource: ResourceConfig;
    readonly identity: string;
    readonly configuration: AdminResourceConfiguration;
};
/** Trusted request attributes supplied by the HTTP runtime, never inferred from headers. */
export type AdminRequestContext = {
    readonly subject: Subject;
    readonly environment: AuthorizationEnvironment;
    readonly reportError?: (error: unknown) => void | Promise<void>;
};
export type AdminApi = {
    readonly basePath: '/__admin';
    handle(request: Request, context: AdminRequestContext): Promise<Response>;
};
export type AdminDefinition = {
    readonly kind: 'nestrum-admin';
    readonly basePath: '/__admin';
    readonly allowedOrigins: readonly string[];
    register(resource: ResourceConfig, configuration: AdminResourceConfiguration): AdminDefinition;
    initialize(application: Application): Promise<AdminApi>;
};
