import { DatabaseRegistryError } from './database.errors.js';
import type { ModelIdentity } from './database.types.js';

export function validateDatabaseName(name: string): void {
    if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        throw new DatabaseRegistryError(
            'INVALID_DATABASE_NAME',
            'Database names must start with a letter or underscore and contain only letters, digits, and underscores.',
        );
    }
}

export function modelIdentity(model: string, database: string = 'default'): ModelIdentity {
    validateDatabaseName(database);

    if (typeof model !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(model)) {
        throw new DatabaseRegistryError(
            'INVALID_MODEL_NAME',
            'Model names must start with a letter or underscore and contain only letters, digits, and underscores.',
        );
    }

    return `${database}.${model}`;
}
