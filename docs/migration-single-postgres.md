# Migrating to one PostgreSQL database

[Decision 0018](decisions/0018-postgresql-single-database.md) is a breaking change. Every application now uses one PostgreSQL database. Upgrade the framework packages together and rebuild generated artifacts before serving the application.

## Application configuration

- Replace `defineApplication({ databases: { default: definition } })` with `defineApplication({ database: definition })`. Keep `kind: 'prisma'`, `provider: 'postgresql'`, and the connection settings.
- Replace `application.databases` and `AppContext.databases` lookups with `.database`; use the DI value `database` instead of `databases`.
- Replace app contributions such as `prisma: { default: ['src/prisma'] }` with `prisma: ['src/prisma']`; replace per-database `prismaSource` maps with one source string.
- Remove `database` from resource definitions, `defineAuth`, `defineFeatures`, auth/feature bindings, and provider extension descriptors. Auth and feature `prisma` callbacks receive `{ application, definition }`.
- Replace per-database `databaseLifecycle` maps with one `{ connect, disconnect }` pair. Keep client construction, collection bindings, and connection cleanup explicit.
- Persistent feature overrides require a `prisma` binding; `FeaturesDefinition.persistent` replaces the database selector. Without that binding, overrides are in memory.

## Identities and clients

Use the model name everywhere: `modelIdentity('Project')`, `application.resources.get('Project')`, and policy `resource: 'Project'` replace their database-qualified forms. Update stored policy configuration and integrations that consume resource metadata or OpenAPI operation IDs (`Project.list`).

Public and admin paths lose database prefixes: `/api/documents/articles` becomes `/api/articles`; `/__admin/documents--articles` becomes `/__admin/articles`; `/admin/documents--articles` becomes `/admin/articles`. Update clients, bookmarks, and tests that use these paths.

| Previous API | Current API |
| --- | --- |
| `assemblePrismaContracts(application, options)` | `assemblePrismaContract(application, options)` returns one contract, or `undefined` when no fragments exist |
| `generatePrismaContracts(application, options)` | `generatePrismaContract(application, options)` returns `{ directory, contract }` |
| `compileModelMetadata({ database, provider, contract })` | `compileModelMetadata({ provider, contract })`; metadata has no `database` field |
| `createPrismaQueryBackend(collection, options)` | `createPrismaQueryBackend(collection)` |
| `authContract(provider)` / `featureContract(provider)` | `authContract()` / `featureContract()` |
| `createPrismaAuthAdapter(binding, provider, codec?)` | `createPrismaAuthAdapter(binding, codec?)` |
| `createPrismaFeatureStore(backend, provider)` | `createPrismaFeatureStore(backend)` |

`ModelMetadata.provider` and `PrismaProvider` remain present and accept only `'postgresql'`. Keep an atomic `AuthPrismaBinding.transaction` implementation when using SSO; merging databases does not construct that binding for you.

## Contracts, migrations, and builds

1. Rename CLI `contractDirs` to singular `contractDir` and remove `--database` from commands. Use the [database workflow](database-workflow.md) for the current configuration.
2. Consolidate models into one schema. Duplicate model names must be resolved before generation; auth and feature model names remain reserved.
3. Reconcile migration histories into the configured `migrationsDir`, which no longer has database-name subdirectories. Review the history against the target database before applying it; moving files alone does not migrate data or reconcile applied migration markers.
4. Run `nestrum db generate`, then plan and review any required migrations with `nestrum db migrate --plan --name <name>`. Apply reviewed migrations with `nestrum db migrate` and verify with `nestrum db status`.
5. Run `nestrum build` and deploy the regenerated build. Manifest v2 contains one `database` entry (or `null`) and uses `contracts/database.json` and `generated/models/database.json`; previous manifests must be rebuilt.
6. Verify resource routes, authorization, authentication, feature overrides, and shutdown against the target database before rollout.

Applications with multiple PostgreSQL databases must consolidate their data and models into one database. MongoDB applications must transfer data to PostgreSQL and update provider-specific schemas, identifiers, and queries. Nestrum provides no automatic data migration tool; preserve backups and validate record counts and relationships during the application's migration.

Earlier phase and post-MVP records describe the original design and remain historical. This guide, decision 0018, and the current architecture define the supported API. External callers outside this repository must apply the same signature changes; repository checks cannot verify them.
