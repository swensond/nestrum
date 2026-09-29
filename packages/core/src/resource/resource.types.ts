import type { QuerySet } from '#core/queryset/queryset';
import type { QueryBackend } from '#core/queryset/queryset.types';
import type { AuthorizationEngine } from '#core/authorization/authorization';
import type { z } from 'zod';
import type { ModelMetadata } from './model-metadata.types.js';
import type { ModelIdentity } from '#core/database/database.types';

export type ResourceSchemaFamily = {
    readonly model: z.ZodObject;
    readonly create: z.ZodObject;
    readonly update: z.ZodObject;
    readonly read: z.ZodObject;
    readonly where: z.ZodType;
    readonly orderBy: z.ZodObject;
};

export type ResourceModel = ResourceSchemaFamily & { readonly metadata: ModelMetadata; readonly queryBackend?: QueryBackend };
export type ResourceSchemaComposers = { readonly [Key in keyof ResourceSchemaFamily]?: (schema: ResourceSchemaFamily[Key]) => ResourceSchemaFamily[Key] };
export type ResourceApiOperation = 'list' | 'retrieve' | 'create' | 'update' | 'delete';
export type ResourceApi = Readonly<Record<ResourceApiOperation, boolean>>;
export type ResourceManagers = Readonly<Record<string, (query: QuerySet) => QuerySet>>;
export type ResourceConfig = {
    readonly model: string;
    readonly database?: string;
    readonly api?: false | Partial<ResourceApi>;
    readonly schemas?: ResourceSchemaComposers;
    readonly managers?: ResourceManagers;
};
export type ResourceDefinition = {
    readonly model: string;
    readonly database: string;
    readonly identity: ModelIdentity;
    readonly api: ResourceApi;
    readonly schemas: ResourceSchemaComposers;
    readonly managers: ResourceManagers;
};
export type RegisteredResource = {
    readonly authorization: AuthorizationEngine;
    readonly model: string;
    readonly database: string;
    readonly identity: ModelIdentity;
    readonly api: ResourceApi;
    readonly metadata: ModelMetadata;
    readonly schemas: ResourceSchemaFamily;
    readonly objects: QuerySet;
    readonly managers: Readonly<Record<string, QuerySet>>;
};
