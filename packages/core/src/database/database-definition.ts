import { DatabaseRegistryError } from './database.errors.js';
import type { DatabaseDefinition } from './database.types.js';

export function validateDatabaseDefinition(value: unknown): asserts value is DatabaseDefinition {
    if (value === null || typeof value !== 'object') {
        throw new DatabaseRegistryError('INVALID_DATABASE_CONFIG', 'A database definition must be an object.');
    }

    const definition = value as Partial<DatabaseDefinition>;

    if (definition.kind !== 'prisma') {
        throw new DatabaseRegistryError('INVALID_DATABASE_CONFIG', 'Database definitions must use kind "prisma".');
    }

    if (definition.provider !== 'postgresql') {
        throw new DatabaseRegistryError('INVALID_DATABASE_CONFIG', 'Database provider must be "postgresql".');
    }

    if (
        typeof definition.connection !== 'string' ||
        !definition.connection.trim() ||
        definition.connection.trim() !== definition.connection
    ) {
        throw new DatabaseRegistryError(
            'INVALID_DATABASE_CONFIG',
            'Database connection must be a nonempty string without surrounding whitespace.',
        );
    }
}
