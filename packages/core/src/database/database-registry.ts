import { validateDatabaseDefinition } from './database-definition.js';
import { DatabaseRegistryError } from './database.errors.js';
import { validateDatabaseName } from './model-identity.js';
import type { DatabaseDefinition, DatabaseEntry } from './database.types.js';

export class DatabaseRegistry {
    private readonly definitions = new Map<string, DatabaseDefinition>();
    private readonly databaseNames: readonly string[];

    constructor(config: Readonly<Record<string, DatabaseDefinition>> | readonly DatabaseEntry[]) {
        if (config === null || typeof config !== 'object') {
            throw new DatabaseRegistryError('INVALID_DATABASE_CONFIG', 'Database configuration must be a named object or an array of named entries.');
        }

        const entries: readonly DatabaseEntry[] = Array.isArray(config) ? config as readonly DatabaseEntry[] : Object.entries(config);

        for (const entry of entries) {
            if (!Array.isArray(entry) || entry.length !== 2) {
                throw new DatabaseRegistryError('INVALID_DATABASE_CONFIG', 'Database entries must contain a name and definition.');
            }

            const [name, definition] = entry;
            validateDatabaseName(name);

            if (this.definitions.has(name)) {
                throw new DatabaseRegistryError('DUPLICATE_DATABASE', `Database "${name}" is registered more than once.`);
            }

            validateDatabaseDefinition(definition);
            this.definitions.set(name, Object.freeze({ kind: definition.kind, provider: definition.provider, connection: definition.connection }));
        }

        if (!this.definitions.has('default')) {
            throw new DatabaseRegistryError('DEFAULT_DATABASE_REQUIRED', 'Application databases must include an own entry named "default".');
        }

        this.databaseNames = Object.freeze([...this.definitions.keys()]);
    }

    has(name: string): boolean {
        return this.definitions.has(name);
    }

    get(name: string = 'default'): DatabaseDefinition {
        const definition = this.definitions.get(name);

        if (!definition) {
            throw new DatabaseRegistryError('DATABASE_NOT_FOUND', `Database "${name}" is not registered.`);
        }

        return definition;
    }

    names(): readonly string[] {
        return this.databaseNames;
    }
}
