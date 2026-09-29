import { AppRegistry } from './app-registry.js';
import { DatabaseRegistry } from '#core/database/database-registry';
import { AppError, AppLifecycleError } from './application.errors.js';
import type { AppContext, AppDefinition, AppHookName, ApplicationConfig, ApplicationState } from './application.types.js';

export class Application {
    readonly apps: AppRegistry;
    readonly databases: DatabaseRegistry;
    private currentState: ApplicationState = 'created';
    private startedApps: AppDefinition[] = [];
    private readonly context: AppContext;

    constructor(config: ApplicationConfig) {
        this.databases = new DatabaseRegistry(config.databases);
        this.apps = new AppRegistry(config.apps);
        this.context = Object.freeze({ application: this, apps: this.apps, databases: this.databases });
    }

    get state(): ApplicationState {
        return this.currentState;
    }

    async start(): Promise<void> {
        if (this.currentState === 'ready') {
            return;
        }

        if (this.currentState !== 'created') {
            throw this.invalidState('start');
        }

        this.currentState = 'starting';

        try {
            for (const app of this.apps.all()) {
                this.startedApps.push(app);
                await this.runHook(app, 'configure');
            }

            for (const app of this.apps.all()) {
                await this.runHook(app, 'ready');
            }

            this.currentState = 'ready';
        } catch (error) {
            const cleanupErrors = await this.stopApps();
            this.currentState = 'failed';

            if (cleanupErrors.length > 0) {
                throw new AppError('APPLICATION_START_FAILED', 'Application startup and rollback failed.', 500, {
                    cause: new AggregateError([error, ...cleanupErrors], 'Startup and rollback errors.')
                });
            }

            throw error;
        }
    }

    async shutdown(): Promise<void> {
        if (this.currentState === 'stopped') {
            return;
        }

        if (this.currentState === 'starting' || this.currentState === 'stopping') {
            throw this.invalidState('shutdown');
        }

        this.currentState = 'stopping';
        const errors = await this.stopApps();
        this.currentState = 'stopped';

        if (errors.length > 0) {
            throw new AppError('APPLICATION_SHUTDOWN_FAILED', 'One or more app shutdown hooks failed.', 500, {
                cause: new AggregateError(errors, 'App shutdown errors.')
            });
        }
    }

    private invalidState(operation: string): AppError {
        return new AppError('APPLICATION_STATE_INVALID', `Cannot ${operation} application while its state is "${this.currentState}".`);
    }

    private async runHook(app: AppDefinition, hook: AppHookName): Promise<void> {
        try {
            await app[hook]?.(this.context);
        } catch (cause) {
            throw new AppLifecycleError(app.name, hook, cause);
        }
    }

    private async stopApps(): Promise<AppLifecycleError[]> {
        const apps = this.startedApps;
        this.startedApps = [];
        const errors: AppLifecycleError[] = [];

        for (const app of apps.reverse()) {
            try {
                await this.runHook(app, 'shutdown');
            } catch (error) {
                errors.push(error instanceof AppLifecycleError ? error : new AppLifecycleError(app.name, 'shutdown', error));
            }
        }

        return errors;
    }
}

export function defineApplication(config: ApplicationConfig): Application {
    return new Application(config);
}
