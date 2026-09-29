# Phase 16 — MVP Integration and Architecture Test

## Status

Not Started

## Goal

Prove fresh resources work end-to-end without changing framework internals.

## Scope

- Use PostgreSQL default.Project and MongoDB documents.Article if verified Prisma 8/runtime support permits.
- Provide independent managers/policies and generated Zod for both databases.
- Enable admin for both, public API for one, and no public API for the other.
- Exercise app dependencies and configured auth database placement.
- Add fresh resources exclusively through application-owned code and contracts.
- Bring every phase document current and mark MVP complete only when all criteria pass.

## Out of Scope

Post-MVP features and masking provider blockers as successful integration.

## Architecture Decisions

If Prisma 8/provider/runtime support prevents Mongo or SQL proof, record the exact blocker and leave the phase and MVP incomplete rather than substituting mock-only acceptance.

## Implementation

Not implemented. The scope and public API below are planned targets, not available behavior.

## Public API

No new primary framework abstraction is planned: integrate existing public interfaces in example apps.

## Files / Packages Changed

None yet. Planned scope: all; @nestrum/testing and example apps as needed. Introduce only packages needed by this phase.

## Tests

Real SQL/Mongo integration of contract assembly, generation, QuerySets, ABAC, auth, public/admin CRUD, CLI, dependencies, and shutdown. Playwright may verify high-level admin flows.

## Acceptance Criteria

- [ ] Fresh resources are added without changing Nestrum packages
- [ ] No manual Hono route file is added
- [ ] No manual OpenAPI code is added
- [ ] No resource-specific Svelte page is added
- [ ] SQL resource works
- [ ] Mongo resource works
- [ ] Admin-only resource works
- [ ] Public resource works
- [ ] Full tests/checks pass
- [ ] docs/mvp.md is marked complete only after validation
- [ ] All phase docs reflect actual implementation

## Validation

```bash
pnpm test
pnpm typecheck
pnpm check
pnpm build
pnpm --filter @nestrum/admin-svelte exec svelte-check-native
```

Not run: phase not started. Add Playwright high-level checks when integration fixtures exist.

## Known Limitations

All capabilities in this phase remain unimplemented. Verify dependency versions and provider/runtime constraints before implementation.

## Follow-Ups

Record unmet criteria and newly deferred work in post-mvp.md.

## Completion Notes

No completion claims. Update this record with actual implementation, test evidence, deviations, and limitations when work begins.
