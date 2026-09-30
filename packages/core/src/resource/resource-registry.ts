import { z } from 'zod';
import { AuthorizationEngine } from '#core/authorization/authorization';
import type { DatabaseRegistry } from '#core/database/database-registry';
import { modelIdentity } from '#core/database/model-identity';
import { bindResourceQuerySets } from '#core/queryset/queryset';
import type { QueryBackend } from '#core/queryset/queryset.types';
import { ResourceError } from './resource.errors.js';
import { defineResource, RESOURCE_SCHEMA_FAMILIES } from './resource.js';
import type { RegisteredResource, ResourceDefinition, ResourceModel, ResourceSchemaFamily } from './resource.types.js';

export class ResourceRegistry {
    private readonly definitions: readonly ResourceDefinition[];
    private registered: ReadonlyMap<string, RegisteredResource> | undefined;
    private ordered: readonly RegisteredResource[] = Object.freeze([]);

    constructor(
        definitions: readonly ResourceDefinition[],
        private readonly databases: DatabaseRegistry,
        private readonly authorization = new AuthorizationEngine(),
    ) {
        if (!Array.isArray(definitions)) {
            throw new ResourceError('RESOURCE_CONFIG_INVALID', 'Resources must be an array of definitions.');
        }
        const identities = new Set<string>();
        this.definitions = Object.freeze(
            Array.from(definitions, (input) => {
                const definition = defineResource(input);
                if (identities.has(definition.identity)) {
                    throw new ResourceError(
                        'RESOURCE_DUPLICATE',
                        `Resource ${definition.identity} is registered more than once.`,
                    );
                }
                if (!databases.has(definition.database)) {
                    throw new ResourceError(
                        'RESOURCE_DATABASE_UNKNOWN',
                        `Resource ${definition.identity} targets an unregistered database.`,
                    );
                }
                identities.add(definition.identity);

                return definition;
            }),
        );
    }

    initialize(models: readonly ResourceModel[]): void {
        if (this.registered) {
            throw new ResourceError('RESOURCE_REGISTRY_INITIALIZED', 'Resource registry is already initialized.');
        }
        if (!Array.isArray(models)) {
            throw new ResourceError('RESOURCE_MODELS_INVALID', 'Resource models must be generated schema families.');
        }
        const available = new Map<string, ResourceModel>();
        for (const model of models) {
            const metadata = model?.metadata;
            if (
                !metadata ||
                !this.databases.has(metadata.database) ||
                metadata.identity !== modelIdentity(metadata.name, metadata.database) ||
                metadata.provider !== this.databases.get(metadata.database).provider ||
                available.has(metadata.identity)
            ) {
                throw new ResourceError(
                    'RESOURCE_MODELS_INVALID',
                    'Resource model metadata has an invalid, duplicate, or unregistered identity/provider.',
                );
            }
            for (const key of RESOURCE_SCHEMA_FAMILIES) {
                if (!(model[key] instanceof z.ZodType) || (key !== 'where' && !(model[key] instanceof z.ZodObject))) {
                    throw new ResourceError(
                        'RESOURCE_MODELS_INVALID',
                        `Model ${metadata.identity} has an invalid ${key} schema.`,
                    );
                }
            }
            available.set(metadata.identity, model);
        }
        const registered = new Map<string, RegisteredResource>();
        for (const definition of this.definitions) {
            const model = available.get(definition.identity);
            if (!model) {
                throw new ResourceError(
                    'RESOURCE_MODEL_MISSING',
                    `Resource ${definition.identity} has no compiled Prisma model.`,
                );
            }
            const schemas = this.compose(definition, model);
            const context = {
                model: definition.model,
                database: definition.database,
                identity: definition.identity,
                api: definition.api,
                apiAccess: definition.apiAccess,
                metadata: model.metadata,
                schemas,
                authorization: this.authorization,
            };
            const access = bindResourceQuerySets(
                context,
                model.queryBackend as
                    | QueryBackend<
                          Record<string, unknown>,
                          Partial<Record<string, unknown>>,
                          Partial<Record<string, unknown>>
                      >
                    | undefined,
                definition.managers,
            );
            const managers = Object.freeze(
                Object.fromEntries(Object.entries(access).filter(([name]) => name !== 'objects')),
            );
            registered.set(definition.identity, Object.freeze({ ...context, ...access, managers }));
        }

        this.ordered = Object.freeze([...registered.values()]);
        this.registered = registered;
    }

    get(identity: string): RegisteredResource {
        const resource = this.ready().get(identity);
        if (!resource) {
            throw new ResourceError('RESOURCE_NOT_FOUND', `Resource ${identity} is not registered.`);
        }

        return resource;
    }

    has(identity: string): boolean {
        return this.ready().has(identity);
    }

    all(): readonly RegisteredResource[] {
        this.ready();

        return this.ordered;
    }

    private ready(): ReadonlyMap<string, RegisteredResource> {
        if (!this.registered) {
            throw new ResourceError(
                'RESOURCE_REGISTRY_NOT_READY',
                'Resources are available after successful model validation at startup.',
            );
        }

        return this.registered;
    }

    private compose(definition: ResourceDefinition, model: ResourceModel): ResourceSchemaFamily {
        const schemas = {
            model: model.model,
            create: model.create,
            update: model.update,
            read: model.read,
            where: model.where,
            orderBy: model.orderBy,
        };
        for (const key of RESOURCE_SCHEMA_FAMILIES) {
            const composer = definition.schemas[key];
            if (!composer) {
                continue;
            }
            try {
                // biome-ignore lint/style/noNonNullAssertion: the union key blocks narrowing, but composer above proved the member exists
                const composed = key === 'where' ? definition.schemas.where!(model.where) : composer(model[key]);
                if (!(composed instanceof z.ZodType) || (key !== 'where' && !(composed instanceof z.ZodObject))) {
                    throw new Error('Schema composer must return a Zod schema of the same family kind.');
                }
                if (key === 'where') {
                    schemas.where = composed;
                } else {
                    schemas[key] = composed as z.ZodObject;
                }
            } catch (cause) {
                throw new ResourceError(
                    'RESOURCE_SCHEMA_FAILED',
                    `Resource ${definition.identity} failed to compose its ${key} schema.`,
                    { cause },
                );
            }
        }

        return Object.freeze(schemas);
    }
}
