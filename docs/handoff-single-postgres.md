# Handoff: PostgreSQL-only, single-database refactor

Branch `claude/single-postgres-database` (branched from `claude/eloquent-sagan-pyrcp5`, which is PR #7, enterprise SSO). Authoritative design: [decision 0018](decisions/0018-postgresql-single-database.md).

## Done and verified

- MongoDB removed everywhere (types, contracts, codecs, query-AST compiler, `example-mongo`, compose service, docs).
- One database: `defineApplication({ database })`, `application.database`, model identity = model name, singular `assemblePrismaContract`/`generatePrismaContract`, no `--database` CLI flag, `contractDir`, manifest v2 (`database` entry), `defineAuth`/`defineFeatures` without `database` (`FeaturesDefinition.persistent`).
- Example app on one PostgreSQL database (Article is now a PostgreSQL model).
- Checks run and passing: `pnpm test` (758), `pnpm typecheck`, `pnpm build`, biome, both `verify:build` scripts, and against a real local PostgreSQL 16: `tooling/integration.mjs` (set `INTEGRATION_POSTGRES_URL` to skip Docker), `verify:api-keys`, `verify:features`, `verify:sso`, `e2e:sso`, `e2e:admin-2fa`.
- Docs updated: architecture, mvp, post-mvp, database-workflow, CONTEXT, READMEs, decisions index, supersession banners on 0003/0004.

## Left to do

1. Run the Docker path once (`pnpm test:integration`) on a machine with Docker: only the PostgreSQL service is now started; the local run used an external database.
2. Open the PR for this branch (none created yet) and note it is a breaking change on top of PR #7; consider retargeting after #7 merges.
3. Phase records `docs/phases/phase-02`…`16` and older post-MVP records still describe named databases/Mongo as history. Either leave (banner in `docs/phases/README.md`) or add a one-line banner to each.
4. Optional cleanups: rename `DatabaseRegistryError` (now only config/model-name errors); `ModelMetadata.provider` and `PrismaProvider` are always `'postgresql'` and could be dropped; `createPrismaFeatureStore`/`createPrismaAuthAdapter` signatures changed, so check any external callers.
5. Migration note for adopters (README/0018 list the breaking changes): rename `databases`→`database`, drop `database:` options, prefix-free identities in policies, singular contract and migration commands, rebuild the manifest.
