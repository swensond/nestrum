# PM5.1 — Typed Registry and Evaluator

## Status

Complete

## Goal

Implement typed boolean flag definitions, registry, defaults, and deterministic in-memory evaluation.

## Scope

- Add `defineFeatureFlags`, `FeatureRegistry`, and `FeatureEvaluator`.
- Preserve strongly typed flag names and reject invalid/duplicate definitions.
- Evaluate declared defaults and in-memory overrides.
- Define a stable context/input shape for later targeting.

## Out of Scope

Persistent storage, targeting/rollouts, InferDI, admin UI/API, client exposure, and multivariate values.

## Architecture Decisions

Depends on [PM5.0](phase-00-contract.md). Keep definitions immutable and source-owned. Evaluation is capability state only; it grants no authorization. Avoid application-specific evaluator APIs and keep extension points compatible with future subject/organization targeting.

## Implementation

`defineFeatureFlags` (`packages/core/src/features/registry.ts`) validates and freezes source declarations into a `FeatureRegistry` and returns typed handles. `FeatureEvaluator` (`evaluator.ts`) evaluates defaults and in-process overrides; `MemoryFeatureStore` backs tests and the no-database configuration. Names are camelCase identifiers of at most 64 characters (`registry` is reserved), defaults must be boolean, and duplicates across `mergeFeatureDefinitions` are rejected. Handles evaluate through the application that registers them and throw `FEATURES_NOT_READY` otherwise. TypeScript infers flag names from the declaration, so unknown flags do not type-check.

## Public API

`defineFeatureFlags`, `FeatureRegistry`, `FeatureEvaluator`, `FeatureHandle.enabled/evaluate`, `mergeFeatureDefinitions`, `FeatureError`.

## Files / Packages Changed

`packages/core/src/features/*`, `packages/core/tests/features.test.ts`, architecture, roadmap, initiative index, and this record.

## Tests

`packages/core/tests/features.test.ts`: typed names, invalid names/definitions, immutability, defaults, repeated deterministic evaluation, in-process overrides, unknown flags, not-ready handles.

## Acceptance Criteria

- [x] Flag names are strongly typed.
- [x] Declared defaults work.
- [x] Evaluator is deterministic.
- [x] In-memory overrides work.
- [x] Docs updated.

## Validation

Run targeted registry tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, and `git diff --check`.

## Known Limitations

Persistence, targeting and request integration are covered by PM5.2–PM5.4.

## Follow-Ups

[PM5.2](phase-02-storage.md) adds Nestrum-owned override persistence.

## Completion Notes

Implemented and verified with the core Vitest project, `pnpm typecheck`, `pnpm build` and `pnpm lint`.
