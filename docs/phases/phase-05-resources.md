# Phase 5 — Resource System

## Status

Not Started

## Goal

Register metadata-driven resources backed by validated models and generated schemas.

## Scope

- Implement defineResource({ model }).
- Default database to default; support explicit named database selection.
- Validate model existence during bootstrap and at build time where feasible.
- Compose generated schemas through resource schema callbacks.
- Disable public API by default; support explicit operation flags and api: false.

## Out of Scope

QuerySets, ABAC, route generation, and admin registration.

## Architecture Decisions

Follow the locked contracts in [architecture](../architecture.md). Exact implementation interfaces remain to be settled during this phase; record durable changes there and rationale in an ADR when needed.

## Implementation

Not implemented. The scope and public API below are planned targets, not available behavior.

## Public API

Planned: defineResource({ database?, model, schemas?, api? }); schemas.create(schema) normally extends a generated schema.

## Files / Packages Changed

None yet. Planned scope: @nestrum/core. Introduce only packages needed by this phase.

## Tests

Registry/model validation, default and named database identity resolution, schema composition, and opt-in API metadata tests.

## Acceptance Criteria

- [ ] Valid resources register
- [ ] Missing Prisma model fails at bootstrap/build where possible
- [ ] Database defaulting works
- [ ] Named database resources work
- [ ] Schema composition works
- [ ] Public API stays disabled unless explicitly enabled
- [ ] Documentation is updated

## Validation

```bash
pnpm test
pnpm typecheck
pnpm check
pnpm build
```

Not run: phase not started.

## Known Limitations

All capabilities in this phase remain unimplemented. Verify dependency versions and provider/runtime constraints before implementation.

## Follow-Ups

Complete this bounded phase before proceeding to the next. Capture newly deferred features in [post-MVP](../post-mvp.md).

## Completion Notes

No completion claims. Update this record with actual implementation, test evidence, deviations, and limitations when work begins.
