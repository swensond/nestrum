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
