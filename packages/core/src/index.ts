export const FRAMEWORK_NAME = 'Nestrum';

export { defineApp } from './application/app.js';
export { AppRegistry } from './application/app-registry.js';
export { Application, defineApplication } from './application/application.js';
export { AppError, AppRegistryError, AppLifecycleError } from './application/application.errors.js';
export type { AppContext, AppDefinition, AppHook, AppHookName, ApplicationConfig, ApplicationState } from './application/application.types.js';

export { DatabaseRegistry } from './database/database-registry.js';
export { DatabaseRegistryError } from './database/database.errors.js';
export { validateDatabaseDefinition } from './database/database-definition.js';
export { modelIdentity } from './database/model-identity.js';
export type { DatabaseDefinition, DatabaseConfig, DatabaseEntry, PrismaProvider, ModelIdentity } from './database/database.types.js';

export { defineResource } from './resource/resource.js';
export { ResourceRegistry } from './resource/resource-registry.js';
export { ResourceError } from './resource/resource.errors.js';
export type { ResourceConfig, ResourceDefinition, ResourceApi, ResourceApiOperation, ResourceModel, ResourceSchemaFamily, ResourceSchemaComposers, RegisteredResource } from './resource/resource.types.js';
export type { FieldMetadata, ModelMetadata, RelationMetadata, ScalarKind } from './resource/model-metadata.types.js';

export { QuerySet, QuerySetError, bindResourceQuerySets, snapshotQueryValue } from './queryset/queryset.js';
export type { QueryBackend, QuerySpec, QueryOrder, QueryWhere, QueryFilter } from './queryset/queryset.types.js';
export type { ResourceManagers } from './resource/resource.types.js';
export { AuthorizationEngine, definePolicy, allow, deny } from './authorization/authorization.js';
export { AuthorizationError, PolicyError } from './authorization/authorization.errors.js';
export { eq, neq, inFilter, inFilter as in, notIn, isNull, and, or, not, compilePolicyScope } from './authorization/filter.js';
export type { FilterExpression, FilterValue } from './authorization/filter.js';
export type { Subject, AuthorizationEnvironment, AuthorizationDecision, AuthorizationBinding, QueryOperation, PolicyContext, PolicyCheck, ActionPolicy, PolicyDefinition } from './authorization/authorization.types.js';
export type { PreparedAuthorization } from './authorization/authorization.js';
export type { QueryState } from './queryset/queryset.types.js';
export type { Authentication, AuthenticationDefinition, AuthSession } from './auth/auth.types.js';
