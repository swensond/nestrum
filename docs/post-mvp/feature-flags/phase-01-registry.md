# PM5.1 — Typed Registry and Evaluator

## Status

Not Started

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

Planned typed registry and evaluator with boolean defaults, in-memory test/dev overrides, and explicit context. Document invalid-name rules and the generated TypeScript inference behavior.

## Public API

Planned `defineFeatureFlags`, registry lookup, `enabled()` evaluation, and typed names.

## Files / Packages Changed

Planned core/runtime package, tests, architecture, initiative index, and this record.

## Tests

Cover typed names, invalid definitions, defaults, overrides, immutability, and deterministic repeated evaluation.

## Acceptance Criteria

- [ ] Flag names are strongly typed.
- [ ] Declared defaults work.
- [ ] Evaluator is deterministic.
- [ ] In-memory overrides work.
- [ ] Docs updated.

## Validation

Run targeted registry tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, and `git diff --check`.

## Known Limitations

No persistent or contextual targeting yet.

## Follow-Ups

[PM5.2](phase-02-storage.md) adds Nestrum-owned override persistence.

## Completion Notes

Pending implementation and validation.
