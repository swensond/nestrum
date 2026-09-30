# Phase 14 — Admin Extensibility and Arbitrary Actions

## Status

Not Started

## Goal

Add admin overrides, custom components, and ABAC-backed arbitrary actions.

## Scope

- Extend admin.register with listDisplay, field widget overrides, and actions.
- Authorize each custom action using its ordinary resource ABAC action name before handler execution.
- Implement a plugin/slot component registry such as adminComponents.register(widget, component).
- Design contribution seams for apps, resources, DI providers, admin components, CLI commands, and database extensions.

## Out of Scope

Full plugin ecosystem, custom admin pages, dashboards, and bulk actions.

## Architecture Decisions

Follow the locked contracts in [architecture](../architecture.md). Exact implementation interfaces remain to be settled during this phase; record durable changes there and rationale in an ADR when needed.

## Implementation

Not implemented. The scope and public API below are planned targets, not available behavior.

## Public API

Planned: admin.register(Resource, { fields: { metadata: { widget: 'json-editor' } }, actions: { archive: ... } }); adminComponents.register('json-editor', JsonEditorField).

## Files / Packages Changed

None yet. Planned scope: @nestrum/admin, @nestrum/admin-ui. Introduce only packages needed by this phase.

## Tests

Custom widget registration/rendering, known action metadata, denied handler non-execution, and authorized custom action execution.

## Acceptance Criteria

- [ ] Custom field widgets register
- [ ] Custom resource actions register
- [ ] Custom actions obey ABAC
- [ ] Admin internals need no editing
- [ ] Documentation is updated

## Validation

```bash
pnpm test
pnpm typecheck
pnpm check
pnpm build
pnpm --filter @nestrum/admin-ui exec svelte-check-native
```

Not run: phase not started.

## Known Limitations

All capabilities in this phase remain unimplemented. Verify dependency versions and provider/runtime constraints before implementation.

## Follow-Ups

Complete this bounded phase before proceeding to the next. Capture newly deferred features in [post-MVP](../post-mvp.md).

## Completion Notes

No completion claims. Update this record with actual implementation, test evidence, deviations, and limitations when work begins.
