import { isApiKeyScope, RESOURCE_AUTH_MODES, type ResourceAuthMode } from '#core/auth/api-key';
import type { ModelIdentity } from '#core/database/database.types';
import { modelIdentity } from '#core/database/model-identity';
import { ResourceError } from './resource.errors.js';
import type {
    ResourceApiAccess,
    ResourceApiOperation,
    ResourceConfig,
    ResourceDefinition,
    ResourceSchemaFamily,
} from './resource.types.js';

/** Regular plural kebab-case model slug shared by the public API and the admin API. */
export function resourceSlug(model: string): string {
    const slug = model
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replaceAll('_', '-')
        .toLowerCase();
    if (/[^aeiou]y$/.test(slug)) {
        return `${slug.slice(0, -1)}ies`;
    }
    if (/(s|x|z|ch|sh)$/.test(slug)) {
        return `${slug}es`;
    }

    return `${slug}s`;
}

export const RESOURCE_API_OPERATIONS = Object.freeze(['list', 'retrieve', 'create', 'update', 'delete'] as const);
export const RESOURCE_SCHEMA_FAMILIES = Object.freeze([
    'model',
    'create',
    'update',
    'read',
    'where',
    'orderBy',
] as const);

function resolveApiAccess(config: ResourceConfig, identity: string): ResourceApiAccess {
    // Registries re-define already defined resources, whose access settings live in `apiAccess`.
    const defined = (config as { readonly apiAccess?: ResourceApiAccess }).apiAccess;
    const api = defined ?? (config.api === false || config.api === undefined ? {} : config.api);
    const auth = api.auth === undefined ? (['session'] as const) : api.auth;
    if (
        !Array.isArray(auth) ||
        auth.length === 0 ||
        new Set(auth).size !== auth.length ||
        !auth.every((mode) => (RESOURCE_AUTH_MODES as readonly unknown[]).includes(mode))
    ) {
        throw new ResourceError(
            'RESOURCE_CONFIG_INVALID',
            `Resource ${identity} api.auth must list each of "session" and "api-key" at most once.`,
        );
    }
    const scopes = api.scopes === undefined ? {} : api.scopes;
    if (!scopes || typeof scopes !== 'object' || Array.isArray(scopes)) {
        throw new ResourceError('RESOURCE_CONFIG_INVALID', `Resource ${identity} api.scopes must be an operation map.`);
    }
    for (const [operation, scope] of Object.entries(scopes)) {
        if (
            !RESOURCE_API_OPERATIONS.includes(operation as ResourceApiOperation) ||
            !isApiKeyScope(scope) ||
            scope.endsWith(':*')
        ) {
            throw new ResourceError(
                'RESOURCE_CONFIG_INVALID',
                `Resource ${identity} api.scopes.${operation} must be a resource:action scope for a public operation.`,
            );
        }
    }

    return Object.freeze({
        auth: Object.freeze([...auth]) as readonly ResourceAuthMode[],
        scopes: Object.freeze({ ...scopes }),
    });
}

/** The scope an API key needs for an operation: the resource's override, else `<slug>:read` or `<slug>:write`. */
export function requiredApiScope(
    resource: { readonly model: string; readonly apiAccess: ResourceApiAccess },
    operation: ResourceApiOperation,
): string {
    return (
        resource.apiAccess.scopes[operation] ??
        `${resourceSlug(resource.model)}:${operation === 'list' || operation === 'retrieve' ? 'read' : 'write'}`
    );
}

export function defineResource(config: ResourceConfig): ResourceDefinition {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
        throw new ResourceError('RESOURCE_CONFIG_INVALID', 'A resource definition must be an object.');
    }
    const database = config.database === undefined ? 'default' : config.database;
    let identity: ModelIdentity;
    try {
        identity = modelIdentity(config.model, database);
    } catch (cause) {
        throw new ResourceError(
            'RESOURCE_CONFIG_INVALID',
            'Resource database and model must be valid identifier segments.',
            { cause },
        );
    }
    const api: Record<ResourceApiOperation, boolean> = {
        list: false,
        retrieve: false,
        create: false,
        update: false,
        delete: false,
    };
    if (config.api !== undefined && config.api !== false) {
        if (!config.api || typeof config.api !== 'object' || Array.isArray(config.api)) {
            throw new ResourceError(
                'RESOURCE_CONFIG_INVALID',
                `Resource ${identity} API configuration must be false or an operation map.`,
            );
        }
        for (const [key, value] of Object.entries(config.api)) {
            if (key === 'auth' || key === 'scopes') {
                continue;
            }
            if (!RESOURCE_API_OPERATIONS.includes(key as ResourceApiOperation) || typeof value !== 'boolean') {
                throw new ResourceError('RESOURCE_CONFIG_INVALID', `Invalid API operation ${key} on ${identity}.`);
            }
            api[key as ResourceApiOperation] = value;
        }
    }
    const apiAccess = resolveApiAccess(config, identity);
    if (config.schemas !== undefined) {
        if (!config.schemas || typeof config.schemas !== 'object' || Array.isArray(config.schemas)) {
            throw new ResourceError(
                'RESOURCE_CONFIG_INVALID',
                `Resource ${identity} schemas must be a composition map.`,
            );
        }
        for (const [key, composer] of Object.entries(config.schemas)) {
            if (
                !RESOURCE_SCHEMA_FAMILIES.includes(key as keyof ResourceSchemaFamily) ||
                typeof composer !== 'function'
            ) {
                throw new ResourceError('RESOURCE_CONFIG_INVALID', `Invalid schema composer ${key} on ${identity}.`);
            }
        }
    }

    if (
        config.managers !== undefined &&
        (!config.managers ||
            typeof config.managers !== 'object' ||
            Array.isArray(config.managers) ||
            Object.values(config.managers).some((value) => typeof value !== 'function'))
    ) {
        throw new ResourceError('RESOURCE_CONFIG_INVALID', `Resource ${identity} managers must be a factory map.`);
    }

    return Object.freeze({
        model: config.model,
        database,
        identity,
        api: Object.freeze(api),
        apiAccess,
        schemas: Object.freeze({ ...config.schemas }),
        managers: Object.freeze({ ...config.managers }),
    });
}
