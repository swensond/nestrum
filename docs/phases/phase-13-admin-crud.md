# Phase 13 — Generic Svelte Admin CRUD

## Status

Not Started

## Goal

Deliver usable generic list/create/edit/delete without per-resource Svelte code.

## Scope

- Implement ResourceList, ResourceTable, ResourceForm, ResourceCreate, ResourceEdit, ResourceDelete, and FieldRenderer.
- Support string, textarea, number, boolean, enum/select, date, datetime, and readonly widgets.
- Use generated metadata for client behavior while retaining authoritative server validation.
- Handle list, create, edit, delete, and validation feedback through generic routes.

## Out of Scope

Polished visual design, uploads, rich text, bulk actions, and advanced relation pickers.

## Architecture Decisions

Follow the locked contracts in [architecture](../architecture.md). Exact implementation interfaces remain to be settled during this phase; record durable changes there and rationale in an ADR when needed.

## Implementation

Not implemented. The scope and public API below are planned targets, not available behavior.

## Public API

Planned generic CRUD and FieldRenderer components consuming admin metadata.

## Files / Packages Changed

None yet. Planned scope: @nestrum/admin-svelte. Introduce only packages needed by this phase.

## Tests

Vitest field/component tests across the initial widgets and generic CRUD behavior, plus Svelte checks and build.

## Acceptance Criteria

- [ ] Generic list works
- [ ] Create works
- [ ] Edit works
- [ ] Delete works
- [ ] Adding an ordinary resource needs zero Svelte code
- [ ] Vitest component tests cover field rendering
- [ ] Documentation is updated

## Validation

```bash
pnpm test
pnpm typecheck
pnpm check
pnpm build
pnpm --filter @nestrum/admin-svelte exec svelte-check-native
```

Not run: phase not started.

## Known Limitations

All capabilities in this phase remain unimplemented. Verify dependency versions and provider/runtime constraints before implementation.

## Follow-Ups

Complete this bounded phase before proceeding to the next. Capture newly deferred features in [post-MVP](../post-mvp.md).

## Completion Notes

No completion claims. Update this record with actual implementation, test evidence, deviations, and limitations when work begins.
