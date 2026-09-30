# PM5.4 — InferDI and Request Integration

## Status

Complete

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

`application.features` exists after startup (`Features`: registry, evaluator, manager, `forRequest`). The Hono runtime registers a scoped InferDI service `features` bound to the trusted request subject and environment and exposes it as `context.var.nestrum.features`; `requestFeatureContext` derives organization from `subject.organizationId ?? environment.organizationId` and the anonymous rollout identifier from `environment.featureKey`, never from headers or cookies. Without configured features the service throws `FEATURES_NOT_CONFIGURED`. Explicit contexts merge over the request context.

## Public API

`RuntimeGraph.features`, `BoundFeatures` (`enabled`, `evaluate`, `exposed`), `requestFeatures`, `requestFeatureContext`, `RequestContext.features`.

## Files / Packages Changed

`packages/hono/src/runtime/{container,runtime,runtime.types}.ts`, `packages/core/src/features/features.ts`, hono tests, architecture, roadmap, initiative index, and this record.

## Tests

`packages/hono/tests/features.test.ts`: injected service with subject and organization context, header spoofing ignored, anonymous rollout only via `featureKey`, scope isolation, unconfigured error, route-conflict rejection, and a route that needs both a flag and an ABAC policy where flipping the flag never grants the action.

## Acceptance Criteria

- [x] Services can inject evaluator.
- [x] Request context is used automatically.
- [x] Anonymous evaluation works by contract.
- [x] Feature checks never bypass ABAC.
- [x] Docs updated.

## Validation

Run runtime integration tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, and `git diff --check`.

## Known Limitations

Declarative resource feature gating is intentionally deferred; use programmatic evaluation.

## Follow-Ups

[PM5.5](phase-05-admin.md) adds protected management UI/API.

## Completion Notes

Both checks stay explicit in application code: feature enabled and ABAC authorized.
