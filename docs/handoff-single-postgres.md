# Handoff: PostgreSQL-only, single-database refactor

Branch `claude/single-postgres-database`. Authoritative design: [decision 0018](decisions/0018-postgresql-single-database.md). [PR #7](https://github.com/swensond/nestrum/pull/7) (enterprise SSO) merged into `main` and this branch on 2026-09-30. [PR #8](https://github.com/swensond/nestrum/pull/8) targets `main`; the remaining diff is the breaking single-PostgreSQL refactor.

## Completed

- MongoDB removed from supported types, contracts, codecs, query-AST compiler, example packages, and compose services.
- One database: `defineApplication({ database })`, `application.database`, model identity = model name, singular `assemblePrismaContract`/`generatePrismaContract`, no `--database` CLI flag, `contractDir`, manifest v2 (`database` entry), `defineAuth`/`defineFeatures` without `database` (`FeaturesDefinition.persistent`).
- Example app uses one PostgreSQL database, including Article, auth, SSO, and feature overrides.
- Docker integration completed on 2026-09-30 with `pnpm test:integration`, without `INTEGRATION_POSTGRES_URL`. Passed generation, migration plan/apply/status, auth/session ABAC, public/admin CRUD, scopes/managers, OpenAPI, generic Svelte forms, consumer browser flows, and reverse shutdown/traffic gating. The dedicated PostgreSQL service and its volumes were removed by the runner.
- The first Docker run exposed a merge regression: the auth contract declared `SsoProvider` twice, including a leftover Mongo declaration. Removed that declaration and strengthened the existing auth contract test to require exactly one declaration of each owned model. The test failed before the fix and passes afterward.
- Current README, architecture, extension seams, and documentation index corrected for singular contracts, model identities, routes, metadata, and extension descriptors. [Adopter migration guide](migration-single-postgres.md) covers configuration, changed signatures, data consolidation, migration history, and manifest rebuilding.
- Historical phases and older post-MVP records retained under the existing [phases banner](phases/README.md) and decision 0018 supersession notice. Their old named-database/Mongo APIs are historical evidence.
- PR #8 already exists against `main`. A replacement title and description are prepared around the final refactor and validation, with PR #7 already merged; publication awaits approval.

## Validation

The previous handoff recorded passing `pnpm test` (758), typecheck, build, Biome, both build verification scripts, and external PostgreSQL 16 runs of integration, API keys, features, SSO, SSO browser, and admin 2FA checks. Those specialized external-database checks were not rerun during this closeout.

Current closeout results (2026-09-30):

- Passed: Docker `pnpm test:integration` (including the workspace build), `pnpm typecheck`, `pnpm lint`, both `verify:build` scripts, the auth contract regression test, and `git diff --check`.
- `pnpm check` remains red at its test stage: 756 of 758 tests pass. Two tests in `packages/cli/tests/dev.test.ts` fail because frontend edits return stale Vite JS/SSR content: “proxies the consumer Vite server behind the backend without restarting it for frontend edits” and “renders server-side through Vite under a base path and applies SSR edits without a backend restart”. Both reproduce in the isolated file, including with `CHOKIDAR_USEPOLLING=1`. Their cause is unresolved; do not treat the full gate as passing.
- Tests/integration/CLI build verification require local listener access; the default sandbox produced `listen EPERM`. Results above use the necessary escalated access. Native listener restrictions do not explain the two remaining failures, which also reproduce with that access.

## Deferred follow-ups

- Diagnose the two Vite edit-refresh failures before considering the repository's full check gate green. Atomic object-policy mutations remain the separate pre-existing MVP completion gate.
- Optional API simplification: rename `DatabaseRegistryError` (now config/model-name errors only); consider removing `ModelMetadata.provider` and `PrismaProvider`, which are always `'postgresql'`. These are deliberately outside this closeout.
- External consumers are not available in this workspace. They must audit `createPrismaFeatureStore(backend)` and `createPrismaAuthAdapter(binding, codec?)` plus the other changes in the migration guide; in-repository integration validates the application bindings.
- Commit/push the closeout changes and update PR #8 after publication approval. Automatic approval review rejected the combined commit/push action because the handoff request did not explicitly authorize publication to `https://github.com/swensond/nestrum`; no commit, push, or PR update was performed. No retargeting is needed now that PR #7 is merged.
- Review and merge PR #8 after the remaining validation follow-up is resolved.
