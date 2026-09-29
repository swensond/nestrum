import type { AuthenticationDefinition } from '#core/auth/auth.types';
import type { AuthorizationEngine } from '#core/authorization/authorization';
import type { PolicyDefinition } from '#core/authorization/authorization.types';
import type { DatabaseConfig } from '#core/database/database.types';
import type { DatabaseRegistry } from '#core/database/database-registry';
import type { ResourceDefinition, ResourceModel } from '#core/resource/resource.types';
import type { ResourceRegistry } from '#core/resource/resource-registry';
import type { AppRegistry } from './app-registry.js';
import type { Application } from './application.js';

export type AppContext = {
    readonly application: Application;
    readonly apps: AppRegistry;
    readonly databases: DatabaseRegistry;
    readonly resources: ResourceRegistry;
    readonly authorization: AuthorizationEngine;
};

export type AppHook = (context: AppContext) => void | Promise<void>;
export type AppHookName = 'configure' | 'ready' | 'shutdown';

export type AppDefinition = {
    readonly name: string;
    readonly dependsOn?: readonly string[];
    readonly resources?: readonly ResourceDefinition[];
    readonly policies?: readonly PolicyDefinition[];
    readonly prisma?: Readonly<Record<string, readonly string[]>>;
    readonly prismaSource?: Readonly<Record<string, string>>;
    readonly configure?: AppHook;
    readonly ready?: AppHook;
    readonly shutdown?: AppHook;
};

export type ApplicationConfig = {
    readonly apps: readonly AppDefinition[];
    readonly databases: DatabaseConfig;
    readonly auth?: AuthenticationDefinition;
    readonly resources?: readonly ResourceDefinition[];
    readonly policies?: readonly PolicyDefinition[];
    readonly resourceModels?:
        | readonly ResourceModel[]
        | ((application: Application) => readonly ResourceModel[] | Promise<readonly ResourceModel[]>);
};

export type ApplicationState = 'created' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed';
