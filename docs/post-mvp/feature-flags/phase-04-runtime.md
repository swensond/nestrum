# PM5.4 — InferDI and Request Integration

## Status

Not Started

## Goal

Make feature evaluation injectable and automatically contextualized by request scope.

## Scope

- Supply `FeatureEvaluator`/`FeatureFlags` through InferDI.
- Populate subject, organization, environment, and attributes from trusted request context.
- Support service injection and explicit context overrides.
- Define anonymous evaluation behavior without invasive identifiers.

## Out of Scope

Admin management, client exposure, declarative resource gating, and cache hardening.

## Architecture Decisions

Depends on [PM5.3](phase-03-targeting.md) and existing InferDI/Hono request ownership. Context attributes are trusted framework/application inputs, never client claims. Feature state does not alter ABAC decisions; both checks remain explicit.

## Implementation

Planned request-scoped evaluator binding and service injection, for example `features.enabled("experimentalSearch")`. Preserve application-owned service construction and lifecycle cleanup.

## Public API

Planned InferDI binding, request context, and service injection contracts.

## Files / Packages Changed

Planned core/Hono/InferDI integration, tests, architecture, initiative index, and this record.

## Tests

Cover injected services, request subject/organization/environment, explicit contexts, anonymous handling, scope isolation, and ABAC remaining enforced.

## Acceptance Criteria

- [ ] Services can inject evaluator.
- [ ] Request context is used automatically.
- [ ] Anonymous evaluation works by contract.
- [ ] Feature checks never bypass ABAC.
- [ ] Docs updated.

## Validation

Run runtime integration tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, and `git diff --check`.

## Known Limitations

Declarative resource feature gating is intentionally deferred; use programmatic evaluation.

## Follow-Ups

[PM5.5](phase-05-admin.md) adds protected management UI/API.

## Completion Notes

Pending implementation and validation.
