export const FRAMEWORK_NAME = 'Nestrum';

export type { AdminErrorCode, AdminTwoFactorReason } from './admin/admin.errors.js';
export { AdminError, AdminTwoFactorRequiredError } from './admin/admin.errors.js';
export type {
    AdminActionConfiguration,
    AdminActionContext,
    AdminApi,
    AdminDefinition,
    AdminFieldConfiguration,
    AdminRequestContext,
    AdminResourceConfiguration,
    AdminResourceRegistration,
    AdminTwoFactorPolicy,
} from './admin/admin.types.js';
export { defineApp } from './application/app.js';
export { AppRegistry } from './application/app-registry.js';
export { AppError, AppLifecycleError, AppRegistryError } from './application/application.errors.js';
export { Application, defineApplication } from './application/application.js';
export type {
    AppContext,
    AppDefinition,
    AppHook,
    AppHookName,
    ApplicationConfig,
    ApplicationLifecycle,
    ApplicationState,
    DatabaseLifecycle,
} from './application/application.types.js';
export type {
    AuthAdministratorInput,
    Authentication,
    AuthenticationDefinition,
    AuthRole,
    AuthSession,
    AuthUserPage,
    AuthUserSummary,
    AuthUsers,
} from './auth/auth.types.js';
export { AuthorizationError, PolicyError } from './authorization/authorization.errors.js';
export type { PreparedAuthorization } from './authorization/authorization.js';
export { AuthorizationEngine, allow, definePolicy, deny } from './authorization/authorization.js';
export type {
    ActionPolicy,
    AuthorizationBinding,
    AuthorizationDecision,
    AuthorizationEnvironment,
    PolicyCheck,
    PolicyContext,
    PolicyDefinition,
    QueryOperation,
    Subject,
} from './authorization/authorization.types.js';
export type { FilterExpression, FilterValue } from './authorization/filter.js';
export {
    and,
    compilePolicyScope,
    eq,
    inFilter,
    inFilter as in,
    isNull,
    neq,
    not,
    notIn,
    or,
} from './authorization/filter.js';
export { DatabaseRegistryError } from './database/database.errors.js';
export type {
    DatabaseConfig,
    DatabaseDefinition,
    DatabaseEntry,
    ModelIdentity,
    PrismaProvider,
} from './database/database.types.js';
export { validateDatabaseDefinition } from './database/database-definition.js';
export { DatabaseRegistry } from './database/database-registry.js';
export { modelIdentity } from './database/model-identity.js';
export { bindResourceQuerySets, QuerySet, QuerySetError, snapshotQueryValue } from './queryset/queryset.js';
export type {
    QueryBackend,
    QueryFilter,
    QueryOrder,
    QuerySpec,
    QueryState,
    QueryWhere,
} from './queryset/queryset.types.js';
export type { FieldMetadata, ModelMetadata, RelationMetadata, ScalarKind } from './resource/model-metadata.types.js';
export { ResourceError } from './resource/resource.errors.js';
export { defineResource, resourceSlug } from './resource/resource.js';
export type {
    RegisteredResource,
    ResourceApi,
    ResourceApiOperation,
    ResourceConfig,
    ResourceDefinition,
    ResourceManagers,
    ResourceModel,
    ResourceSchemaComposers,
    ResourceSchemaFamily,
} from './resource/resource.types.js';
export { ResourceRegistry } from './resource/resource-registry.js';
