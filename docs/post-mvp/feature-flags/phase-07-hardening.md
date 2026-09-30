# PM5.7 — Feature-Flag Hardening

## Status

Not Started

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

Planned final workflow checks for defaults, overrides, targeting, rollouts, request injection, admin security, consumer filtering, and API authorization. Record hash/version, cache, clock, invalidation, and audit semantics demonstrated by implementation.

## Public API

Finalize testing helper, dev override, diagnostics, cache invalidation, audit seam, and consumer exposure contracts. Update docs only to describe shipped behavior.

## Files / Packages Changed

Planned integration tests/fixtures, CLI diagnostics, core/runtime/admin/web hardening, architecture, post-MVP roadmap, and all PM5 records.

## Tests

Vitest covers all precedence and isolation cases. Playwright covers admin management, evaluation explanations, consumer exposure, and relevant UI behavior. Integration verifies flags never bypass ABAC.

## Acceptance Criteria

- [ ] Test overrides are isolated.
- [ ] Dev overrides do not mutate storage.
- [ ] Diagnostics explain decisions safely.
- [ ] Cache/invalidation behavior is deterministic if present.
- [ ] Audit seam is exercised.
- [ ] Docs updated.
- [ ] Initiative definition of done passes and PM5 is marked complete.

## Validation

Run targeted feature/admin/consumer integration, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, `svelte-check-native`, browser checks, and `git diff --check`. Record evidence before marking Complete.

## Known Limitations

Future multivariate values and declarative resource gating remain separately scoped. Document any provider/runtime limitations demonstrated by implementation.

## Follow-Ups

Record experiments, broader targeting, resource declarations, and full audit history in the post-MVP roadmap after PM5 completion.

## Completion Notes

Pending implementation and validation. PM5 remains incomplete until all phases and definition-of-done items pass.
