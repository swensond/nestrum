# Phase 6 — QuerySets and Managers

## Status

Not Started

## Goal

Provide immutable Prisma-backed QuerySets as the standard access layer.

## Scope

- Implement immutable filter(), orderBy(), and limit() chaining.
- Provide all(), first(), get(), exists(), count(), create(), update(), and delete().
- Always expose an irreplaceable objects manager.
- Support first-class chainable named managers such as active and archived.
- Return the underlying Prisma delegate from raw().

## Out of Scope

ABAC integration (Phase 7), HTTP, auth, and admin.

## Architecture Decisions

raw() deliberately bypasses Nestrum guarantees, including later automatic ABAC scoping and manager behavior. Document this at the public API boundary.

## Implementation

Not implemented. The scope and public API below are planned targets, not available behavior.

## Public API

Planned: Project.objects.filter({ status: 'active' }).orderBy('-createdAt').limit(20).all(); Project.active; Project.objects.raw().

## Files / Packages Changed

None yet. Planned scope: @nestrum/core, @nestrum/prisma. Introduce only packages needed by this phase.

## Tests

Immutable branching and delayed execution, delegate call arguments for every evaluation method, manager composition/reserved-name protection, and raw delegate identity.

## Acceptance Criteria

- [ ] QuerySets are immutable
- [ ] Chaining produces correct Prisma operations
- [ ] objects always exists and cannot be replaced
- [ ] Custom managers work
- [ ] Managers remain chainable
- [ ] Django-style evaluation methods work
- [ ] raw exposes the Prisma delegate
- [ ] raw safety semantics are explicitly documented
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
