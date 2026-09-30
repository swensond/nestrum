import type { z } from 'zod';
import type { ResourceAuthMode } from '#core/auth/api-key';
import type { AuthorizationEngine } from '#core/authorization/authorization';
import type { ModelIdentity } from '#core/database/database.types';
import type { QuerySet } from '#core/queryset/queryset';
import type { QueryBackend } from '#core/queryset/queryset.types';
import type { ModelMetadata } from './model-metadata.types.js';

export type ResourceSchemaFamily = {
    readonly model: z.ZodObject;
    readonly create: z.ZodObject;
    readonly update: z.ZodObject;
    readonly read: z.ZodObject;
    readonly where: z.ZodType;
    readonly orderBy: z.ZodObject;
};

export type ResourceModel = ResourceSchemaFamily & {
    readonly metadata: ModelMetadata;
    readonly queryBackend?: QueryBackend;
};
export type ResourceSchemaComposers = {
    readonly [Key in keyof ResourceSchemaFamily]?: (schema: ResourceSchemaFamily[Key]) => ResourceSchemaFamily[Key];
};
export type ResourceApiOperation = 'list' | 'retrieve' | 'create' | 'update' | 'delete';
export type ResourceApi = Readonly<Record<ResourceApiOperation, boolean>>;
/** Who may call a resource's public API and which scope an API key needs for each operation. */
export type ResourceApiAccess = {
    /** Accepted authentication modes. Defaults to `['session']`; API keys are opt-in per resource. */
    readonly auth: readonly ResourceAuthMode[];
    /** Overrides of the default `<slug>:read` / `<slug>:write` scope required for an operation. */
    readonly scopes: Readonly<Partial<Record<ResourceApiOperation, string>>>;
};
export type ResourceManagers = Readonly<Record<string, (query: QuerySet) => QuerySet>>;
export type ResourceConfig = {
    readonly model: string;
    readonly api?:
        | false
        | (Partial<ResourceApi> & {
              readonly auth?: readonly ResourceAuthMode[];
              readonly scopes?: Partial<Record<ResourceApiOperation, string>>;
          });
    readonly schemas?: ResourceSchemaComposers;
    readonly managers?: ResourceManagers;
};
export type ResourceDefinition = {
    readonly model: string;
    readonly identity: ModelIdentity;
    readonly api: ResourceApi;
    readonly apiAccess: ResourceApiAccess;
    readonly schemas: ResourceSchemaComposers;
    readonly managers: ResourceManagers;
};
export type RegisteredResource = {
    readonly authorization: AuthorizationEngine;
    readonly model: string;
    readonly identity: ModelIdentity;
    readonly api: ResourceApi;
    readonly apiAccess: ResourceApiAccess;
    readonly metadata: ModelMetadata;
    readonly schemas: ResourceSchemaFamily;
    readonly objects: QuerySet;
    readonly managers: Readonly<Record<string, QuerySet>>;
};
