import { DatabaseRegistryError } from './database.errors.js';
import type { ModelIdentity } from './database.types.js';

export function modelIdentity(model: string): ModelIdentity {
    if (typeof model !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(model)) {
        throw new DatabaseRegistryError(
            'INVALID_MODEL_NAME',
            'Model names must start with a letter or underscore and contain only letters, digits, and underscores.',
        );
    }

    return model;
}
