# PM5.0 — Feature-Flag Contract

## Status

Complete

## Goal

Document typed boolean flags, defaults, evaluation precedence, deterministic targeting, storage ownership, ABAC separation, admin management, and consumer exposure.

## Scope

- Create the PM5 index and seven bounded phase records.
- Define registry/evaluator, persistence, context, targeting, rollout, InferDI, admin, client filtering, dev overrides, testing, caching, and audit seams.
- Link the initiative from the post-MVP roadmap, architecture, and documentation index.

## Out of Scope

Registry/storage/evaluator implementation, admin UI/API, consumer integration, dependencies, and current runtime behavior.

## Architecture Decisions

Flags answer capability availability; ABAC remains authoritative for authorization. Start with booleans and source defaults. Planned precedence is subject → organization → percentage → environment → default. Rollouts are deterministic and anonymous evaluation requires an application-provided stable identifier. Only server-evaluated, explicitly exposed values reach browsers.

## Implementation

Added the initiative index and PM5.0–PM5.7 records. PM5.0 is complete; PM5.1–PM5.7 remain Not Started. No feature, storage, admin, or client code changed.

## Public API

Documents planned `defineFeatureFlags`, `FeatureRegistry`, `FeatureEvaluator`, `FeatureContext`, `web exposeToClient`, admin routes, and dev/testing helper shapes. No executable behavior is added.

## Files / Packages Changed

New `docs/post-mvp/feature-flags/` documents plus updates to `docs/post-mvp.md`, `docs/architecture.md`, and `docs/README.md`. No package changes.

## Tests

Documentation validation only: required files/sections, relative links, and whitespace.

## Acceptance Criteria

- [x] Flag definition and typed registry contract documented.
- [x] Evaluation precedence and deterministic rollout documented.
- [x] ABAC separation documented.
- [x] Storage and client exposure rules documented.
- [x] Phase records and roadmap links created.

## Validation

Verify all eight records, local links, standard sections, and `git diff --check`.

## Known Limitations

Feature flags are not implemented or evaluated by the current runtime. Exact hash, schema, cache, admin response, and helper APIs require implementation decisions.

## Follow-Ups

[PM5.1](phase-01-registry.md) implements the typed registry and evaluator. The remaining MVP atomic object-policy write gate remains independent.

## Completion Notes

PM5.0 records the plan without changing authorization or runtime behavior.
