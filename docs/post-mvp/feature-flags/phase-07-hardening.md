# PM5.7 — Feature-Flag Hardening

## Status

Complete

## Goal

Complete deterministic testing helpers, development overrides, diagnostics, cache invalidation, audit seam, and end-to-end verification.

## Scope

- Add isolated `withFeatureFlags`-style test overrides.
- Add process-local `nestrum dev --feature name=value` overrides without persistence mutation.
- Explain evaluation decisions and winning precedence safely.
- Add deterministic cache invalidation if caching is introduced.
- Verify audit/event emission for privileged changes.
- Run Vitest, Playwright, resource/API, admin, and consumer integration coverage.
- Update architecture, roadmap, and all PM5 records to actual behavior.

## Out of Scope

Multivariate experimentation, declarative resource feature gating, invasive anonymous tracking, and a full audit-history product.

## Architecture Decisions

Depends on PM5.1–PM5.6. Correctness precedes caching; stale state must never be unpredictable after configuration changes. Dev/test overrides are scoped and non-persistent. Diagnostics disclose rule reasoning but not sensitive targeting attributes. Feature flags remain separate from ABAC in every integration path.

## Implementation

`withFeatureFlags(flags, overrides, callback)` binds the flags to a fresh in-memory evaluator and restores the previous binding, even on error; `evaluator.withOverrides()` derives an isolated evaluator. `nestrum dev --feature name=true|false` (repeatable, dev only) sets `NESTRUM_DEV_FEATURES`, which `defineFeatures` honors only when `NESTRUM_ENV` is `development`; overrides are process-local, never persisted, listed in the dev banner, and the environment is restored on close. Evaluations explain themselves safely; the rule cache (`cacheTtlMs`, default off) is invalidated synchronously by manager writes and by `invalidate()`; `onChange` listeners receive an audit event per persisted change and their failures never undo it. Storage failures fall back to source defaults. The example gained flags, an admin/consumer integration section and `verify:features`.

## Public API

`withFeatureFlags`, `FeatureEvaluatorApi.withOverrides/invalidate`, `parseDevOverrides`, `DEV_OVERRIDES_ENV`, `--feature`, `featureDiagnostics`, `FeatureChangeEvent`.

## Files / Packages Changed

`packages/core/src/features/features.ts`, `packages/features/src/define.ts`, `packages/cli/src/{runtime-arguments,dev,bin}.ts`, example app and tooling, tests, architecture, roadmap, all PM5 records, decision 0016, README.

## Tests

Core tests cover isolation and restoration in `withFeatureFlags`, cache TTL and invalidation, audit events and listener failures, degraded fallback. CLI tests cover argument parsing and a real `nestrum dev --feature` run whose served value is overridden while storage stays empty and the environment is restored. `verify:features` passed on real PostgreSQL. Final validation of this change: `pnpm check` (tests, typecheck, build, admin-ui and CLI build verification), `pnpm lint`, `pnpm --filter @nestrum/example check:web` and `git diff --check`; the only failure seen in the full run was the timing-sensitive `nestrum dev` consumer-Vite HMR test, which passes when run alone.

## Acceptance Criteria

- [x] Test overrides are isolated.
- [x] Dev overrides do not mutate storage.
- [x] Diagnostics explain decisions safely.
- [x] Cache/invalidation behavior is deterministic if present.
- [x] Audit seam is exercised.
- [x] Docs updated.
- [x] Initiative definition of done passes and PM5 is marked complete.

## Validation

Run targeted feature/admin/consumer integration, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, `svelte-check-native`, browser checks, and `git diff --check`. Record evidence before marking Complete.

## Known Limitations

The Docker + MongoDB integration run (`pnpm test:integration`, including its feature-flag section and the Playwright consumer check) was run by the project owner and passes. Multivariate values, attribute targeting, declarative resource gating and audit history remain future work. Cross-process cache invalidation is bounded by `cacheTtlMs`.

## Follow-Ups

Record experiments, broader targeting, resource declarations, and full audit history in the post-MVP roadmap after PM5 completion.

## Completion Notes

PM5 meets its definition of done in code, unit/integration tests, real-PostgreSQL verification and documentation; the project owner's Docker integration run passes.
