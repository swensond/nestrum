import { defineApp } from './app.js';
import { AppRegistryError } from './application.errors.js';
import type { AppDefinition } from './application.types.js';

export class AppRegistry {
    private readonly definitions = new Map<string, AppDefinition>();
    private readonly orderedApps: readonly AppDefinition[];

    constructor(apps: readonly AppDefinition[]) {
        for (const definition of apps) {
            const app = defineApp(definition);

            if (this.definitions.has(app.name)) {
                throw new AppRegistryError('DUPLICATE_APP', `App "${app.name}" is registered more than once.`);
            }

            this.definitions.set(app.name, app);
        }

        for (const app of this.definitions.values()) {
            for (const dependency of app.dependsOn ?? []) {
                if (!this.definitions.has(dependency)) {
                    throw new AppRegistryError(
                        'MISSING_APP_DEPENDENCY',
                        `App "${app.name}" depends on unregistered app "${dependency}".`,
                    );
                }
            }
        }

        this.orderedApps = Object.freeze(this.orderApps());
    }

    has(name: string): boolean {
        return this.definitions.has(name);
    }

    get(name: string): AppDefinition {
        const app = this.definitions.get(name);

        if (!app) {
            throw new AppRegistryError('APP_NOT_FOUND', `App "${name}" is not registered.`);
        }

        return app;
    }

    all(): readonly AppDefinition[] {
        return this.orderedApps;
    }

    private orderApps(): AppDefinition[] {
        const ordered: AppDefinition[] = [];
        const visited = new Set<string>();
        const visiting = new Set<string>();
        const path: string[] = [];

        const visit = (app: AppDefinition): void => {
            if (visiting.has(app.name)) {
                const cycle = [...path.slice(path.indexOf(app.name)), app.name];
                throw new AppRegistryError('APP_DEPENDENCY_CYCLE', `App dependency cycle: ${cycle.join(' -> ')}.`);
            }

            if (visited.has(app.name)) {
                return;
            }

            visiting.add(app.name);
            path.push(app.name);

            for (const dependency of app.dependsOn ?? []) {
                visit(this.get(dependency));
            }

            path.pop();
            visiting.delete(app.name);
            visited.add(app.name);
            ordered.push(app);
        };

        for (const app of this.definitions.values()) {
            visit(app);
        }

        return ordered;
    }
}
