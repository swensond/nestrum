import { modelIdentity } from '#core/database/model-identity';
import { ResourceError } from './resource.errors.js';
import type { ModelIdentity } from '#core/database/database.types';
import type { ResourceApiOperation, ResourceConfig, ResourceDefinition, ResourceSchemaFamily } from './resource.types.js';

export const RESOURCE_API_OPERATIONS = Object.freeze(['list', 'retrieve', 'create', 'update', 'delete'] as const);
export const RESOURCE_SCHEMA_FAMILIES = Object.freeze(['model', 'create', 'update', 'read', 'where', 'orderBy'] as const);

export function defineResource(config: ResourceConfig): ResourceDefinition {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
        throw new ResourceError('RESOURCE_CONFIG_INVALID', 'A resource definition must be an object.');
    }
    const database = config.database === undefined ? 'default' : config.database;
    let identity: ModelIdentity;
    try {
        identity = modelIdentity(config.model, database);
    } catch (cause) {
        throw new ResourceError('RESOURCE_CONFIG_INVALID', 'Resource database and model must be valid identifier segments.', { cause });
    }
    const api: Record<ResourceApiOperation, boolean> = { list: false, retrieve: false, create: false, update: false, delete: false };
    if (config.api !== undefined && config.api !== false) {
        if (!config.api || typeof config.api !== 'object' || Array.isArray(config.api)) {
            throw new ResourceError('RESOURCE_CONFIG_INVALID', `Resource ${identity} API configuration must be false or an operation map.`);
        }
        for (const [key, value] of Object.entries(config.api)) {
            if (!RESOURCE_API_OPERATIONS.includes(key as ResourceApiOperation) || typeof value !== 'boolean') {
                throw new ResourceError('RESOURCE_CONFIG_INVALID', `Invalid API operation ${key} on ${identity}.`);
            }
            api[key as ResourceApiOperation] = value;
        }
    }
    if (config.schemas !== undefined) {
        if (!config.schemas || typeof config.schemas !== 'object' || Array.isArray(config.schemas)) {
            throw new ResourceError('RESOURCE_CONFIG_INVALID', `Resource ${identity} schemas must be a composition map.`);
        }
        for (const [key, composer] of Object.entries(config.schemas)) {
            if (!RESOURCE_SCHEMA_FAMILIES.includes(key as keyof ResourceSchemaFamily) || typeof composer !== 'function') {
                throw new ResourceError('RESOURCE_CONFIG_INVALID', `Invalid schema composer ${key} on ${identity}.`);
            }
        }
    }

    return Object.freeze({ model: config.model, database, identity, api: Object.freeze(api), schemas: Object.freeze({ ...config.schemas }) });
}
