import type { Application } from './application.js';
import type { AppRegistry } from './app-registry.js';
import type { DatabaseRegistry } from '#core/database/database-registry';
import type { DatabaseConfig } from '#core/database/database.types';

export type AppContext = {
    readonly application: Application;
    readonly apps: AppRegistry;
    readonly databases: DatabaseRegistry;
};

export type AppHook = (context: AppContext) => void | Promise<void>;
export type AppHookName = 'configure' | 'ready' | 'shutdown';

export type AppDefinition = {
    readonly name: string;
    readonly dependsOn?: readonly string[];
    readonly prisma?: Readonly<Record<string, readonly string[]>>;
    readonly configure?: AppHook;
    readonly ready?: AppHook;
    readonly shutdown?: AppHook;
};

export type ApplicationConfig = {
    readonly apps: readonly AppDefinition[];
    readonly databases: DatabaseConfig;
};

export type ApplicationState = 'created' | 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed';
