# PM5.2 — Persistent Override Storage

## Status

Complete

## Goal

Persist Nestrum-owned feature overrides while retaining source defaults as fallback.

## Scope

- Allow applications to select a backing database (`default`, `configuration`, or validated named database).
- Add Nestrum-owned Prisma models for global/environment and future targeting records.
- Read missing/disabled overrides as declared defaults.
- Validate configuration and preserve future subject/organization/rollout fields.

## Out of Scope

Full targeting evaluation, admin management, InferDI, client exposure, caching, and migrations beyond the persistence contract.

## Architecture Decisions

Depends on [PM5.1](phase-01-registry.md). Storage is framework-owned but database selection is explicit. Source defaults remain deployable fallback when storage is empty or unavailable according to the documented failure policy. Do not let persistence turn feature state into authorization.

## Implementation

New package `@nestrum/features`. `defineFeatures({ flags, database, prisma, environment, cacheTtlMs, overrides, onChange, onError })` returns a `FeaturesDefinition` for `defineApplication({ features })`. Nestrum contributes a protected `FeatureOverride` Prisma fragment (PostgreSQL and MongoDB variants, unique `(flag, scope, target)`, index on `flag`) to the selected database as the `nestrum.features` app; `createPrismaFeatureStore` reads and writes it through the Prisma query backend. Without `database`/`prisma`, overrides are in memory. A missing or failing store evaluates to the declared default and reports the error.

## Public API

`defineFeatures`, `FeaturesConfig`, `FeaturePrismaBinding`, `createPrismaFeatureStore`, `featureContract`, `FEATURE_MODELS`, `Application.features`/`featuresConfigured`, `ApplicationConfig.features`.

## Files / Packages Changed

New `packages/features`, `packages/core` application/types, `vitest.workspace.ts`, `pnpm-lock.yaml`, example application, architecture, roadmap, initiative index, and this record.

## Tests

`packages/features/tests/features.test.ts`: real Prisma contract emission for both providers, store behavior on both providers (upsert, unique key, list ordering, malformed rows, lost create race), configuration validation, protected-model rejection, database mismatch. `pnpm --filter @nestrum/example verify:features` ran against a real PostgreSQL 16 database migrated through `nestrum db migrate` (table, unique constraint and index created; persistence, concurrent-writer convergence, precedence, rollout and failure fallback passed).

## Acceptance Criteria

- [x] Configured database stores overrides.
- [x] Source defaults remain fallback.
- [x] Storage supports future targeting records.
- [x] Docs updated.

## Validation

Run storage/migration tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, applicable compiled checks, and `git diff --check`.

## Known Limitations

MongoDB storage is verified through contract emission and unit tests; its live run is part of the Docker integration suite, which the project owner ran and passes. Upserts are read-then-write, so concurrent writers converge on one row with last-writer-wins.

## Follow-Ups

[PM5.3](phase-03-targeting.md) adds contextual overrides and rollouts.

## Completion Notes

Existing applications adopting features migrate one additive table. Storage never turns feature state into authorization.
