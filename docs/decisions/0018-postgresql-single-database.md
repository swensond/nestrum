# 0018 — PostgreSQL only, one database per application

## Status

Accepted. Supersedes the multi-database and MongoDB parts of [0003](0003-database-registration-boundary.md), [0004](0004-prisma-contract-assembly.md) and the phase records that describe them (Phases 2–4, 6, 9, 15–16), which remain as history.

## Context

Nestrum started with named databases and two providers (PostgreSQL and MongoDB) so that one application could mix stores. In practice that flexibility cost more than it returned:

- Every model identity, resource, policy, route, admin slug, migration directory and CLI flag carried a database name.
- The Prisma 8 Mongo runtime has no transaction or session API, so features that need atomicity, such as SSO `resolveUser` (see [0017](0017-enterprise-sso.md)), could not work on Mongo at all, and MongoDB needed its own contracts, codecs, count callbacks and query-AST compiler.
- Each provider needed its own emitted package, Docker service and integration coverage.

## Decision

- **One provider.** PostgreSQL through Prisma 8 is the only supported provider. `PrismaProvider` is `'postgresql'`; MongoDB definitions, contracts, codecs, the Mongo query-AST compiler, the `@nestrum/example-mongo` package and its Docker service are removed.
- **One database.** An application has exactly one database: `defineApplication({ database: { kind: 'prisma', provider: 'postgresql', connection } })`. `application.database` replaces `application.databases`; `AppContext.database` replaces `AppContext.databases`; the DI value `database` replaces `databases`. `DatabaseRegistry` and database names are gone.
- **Model identity is the model name** (`Project`). Policies, ABAC resources, admin identities, `application.resources.get('Project')` and OpenAPI operation IDs (`Project.list`) use it. Because one Prisma schema cannot hold two models with one name, identities are unique by construction. The `default.`/`documents.` prefixes and `documents--articles` admin slugs and `/api/documents/...` routes disappear.
- **Contributions.** `defineApp({ prisma: ['path', ...], prismaSource: 'inline source' })` replaces the per-database maps. Auth, API-key, SSO and feature models are contributed to the same database and their identities are protected the same way as before.
- **Auth and features.** `defineAuth` and `defineFeatures` drop their `database` option; `prisma` callbacks receive `{ application, definition }`, and `defineFeatures` is persistent exactly when `prisma` is supplied (`FeaturesDefinition.persistent`). `AuthPrismaBinding` and `FeaturePrismaBinding` no longer name a database.
- **Lifecycle.** `databaseLifecycle` is one `{ connect, disconnect }` pair.
- **Transactions.** Because the one provider is PostgreSQL, `AuthPrismaBinding.transaction` (see [0017](0017-enterprise-sso.md)) is the supported way to make auth units of work atomic; Mongo's missing transactions no longer constrain the design.
- **CLI and build.** `nestrum db generate|migrate|status` lose `--database`. `CliConfig.contractDirs` becomes `contractDir`, migrations live directly under `migrationsDir`, and a dev schema change prints `nestrum db migrate`. The build manifest is version 2 with one `database` entry (`contracts/database.json`, `generated/models/database.json`) or `null`. `@nestrum/prisma` exposes `assemblePrismaContract` and `generatePrismaContract` (singular), returning one contract; `ModelMetadata` no longer has a `database` field; `createPrismaQueryBackend(collection)` takes no provider options; `authContract()`, `featureContract()` and `createPrismaAuthAdapter(binding, codec?)` take no provider.

## Consequences

- This is a breaking change for any application built on the previous API: rename `databases` to `database`, drop `database:` options, prefix-free identities in policies, singular contract and migration commands, and a manifest rebuild. Applications that used a second PostgreSQL database must merge its models into one schema.
- Applications that stored data in MongoDB must move it to PostgreSQL; there is no migration tool.
- The `Session.authMethod`, `SsoProvider` and other auth tables live in the application database alongside product tables. Identity and product data share one migration history.
- A future multi-tenant or multi-store need would have to be designed fresh rather than through named databases.
- Historical phase and decision records still describe the earlier model. This decision and [the architecture](../architecture.md) are authoritative.

## References

- [Adopter migration guide](../migration-single-postgres.md)
- [0003 — Database registration boundary](0003-database-registration-boundary.md)
- [0004 — Prisma contract assembly](0004-prisma-contract-assembly.md)
- [0017 — Enterprise SSO](0017-enterprise-sso.md)
