import type { AdminDefinition } from '#core/admin/admin.types';
import type { AuthenticationDefinition } from '#core/auth/auth.types';
import type { AuthorizationEngine } from '#core/authorization/authorization';
import type { PolicyDefinition } from '#core/authorization/authorization.types';
import type { DatabaseDefinition } from '#core/database/database.types';
import type { FeaturesDefinition } from '#core/features/features.types';
import type { ResourceDefinition, ResourceModel } from '#core/resource/resource.types';
import type { ResourceRegistry } from '#core/resource/resource-registry';
import type { AppRegistry } from './app-registry.js';
import type { Application } from './application.js';

export type AppContext = {
    readonly application: Application;
    readonly apps: AppRegistry;
    readonly database: DatabaseDefinition;
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
    /** Prisma schema files or directories this app contributes to the application's database. */
    readonly prisma?: readonly string[];
    /** Inline Prisma schema source this app contributes to the application's database. */
    readonly prismaSource?: string;
    readonly configure?: AppHook;
    readonly ready?: AppHook;
    readonly shutdown?: AppHook;
};

export type ApplicationConfig = {
    readonly apps: readonly AppDefinition[];
    /** The application's one database. */
    readonly database: DatabaseDefinition;
    readonly prepare?: (application: Application) => void | Promise<void>;
    readonly databaseLifecycle?: DatabaseLifecycle;
    readonly auth?: AuthenticationDefinition;
    readonly admin?: AdminDefinition;
    readonly features?: FeaturesDefinition;
    readonly resources?: readonly ResourceDefinition[];
    readonly policies?: readonly PolicyDefinition[];
    readonly resourceModels?:
        | readonly ResourceModel[]
        | ((application: Application) => readonly ResourceModel[] | Promise<readonly ResourceModel[]>);
};

export type DatabaseLifecycle = {
    readonly connect: () => void | Promise<void>;
    readonly disconnect: () => void | Promise<void>;
};
export type ApplicationLifecycle = {
    readonly beforeReady?: () => void | Promise<void>;
    readonly afterApps?: () => void | Promise<void>;
};

export type ApplicationState = 'created' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed';
