# Phase 7 — ABAC Engine

## Status

Not Started

## Goal

Implement default-deny resource/action authorization with database collection scopes.

## Scope

- Evaluate subject, action, resource, and environment.
- Provide allow() and deny(reason); support arbitrary action names from day one.
- Allow collection scope and object authorization; resource denial always wins.
- Build provider-neutral eq/neq/in/notIn/isNull/and/or/not filter AST helpers.
- Compile collection scopes into Prisma and integrate authorizedFor(subject, action).

## Out of Scope

Field-level ABAC, auth/session plumbing, HTTP, and admin.

## Architecture Decisions

Follow the locked contracts in [architecture](../architecture.md). Exact implementation interfaces remain to be settled during this phase; record durable changes there and rationale in an ADR when needed.

## Implementation

Not implemented. The scope and public API below are planned targets, not available behavior.

## Public API

Planned: allow(), deny(reason), filter AST helpers, policy scope/object callbacks, and QuerySet.authorizedFor(subject, action).

## Files / Packages Changed

None yet. Planned scope: @nestrum/core, @nestrum/prisma. Introduce only packages needed by this phase.

## Tests

Default deny, deny precedence, arbitrary actions, object decisions, filter AST composition, and delegate arguments proving DB-level scoping.

## Acceptance Criteria

- [ ] Missing policy denies
- [ ] Missing action denies
- [ ] Arbitrary actions work
- [ ] Object authorization works
- [ ] Collection scope compiles to Prisma
- [ ] Filtering happens in the database query, not post-fetch
- [ ] Policy tests are readable
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
