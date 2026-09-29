# Phase 11 — Admin Backend Boundary

## Status

Not Started

## Goal

Create the private admin API independently of public API exposure.

## Scope

- Serve /__admin/* behind Better Auth session and admin.access ABAC.
- Enforce same-origin by default; allow explicit admin.allowedOrigins.
- Implement separate admin.register(resource, configuration).
- Expose resource/field metadata, list configuration, generic CRUD, known custom actions, and authorized resource discovery.
- Reuse QuerySets and ABAC, including for api: false resources.

## Out of Scope

Svelte UI, public-route coupling, polished design, and custom action handler implementation beyond the metadata seam.

## Architecture Decisions

Follow the locked contracts in [architecture](../architecture.md). Exact implementation interfaces remain to be settled during this phase; record durable changes there and rationale in an ADR when needed.

## Implementation

Not implemented. The scope and public API below are planned targets, not available behavior.

## Public API

Planned: admin.register(Resource, { listDisplay, fields?, actions? }) and admin.allowedOrigins; /__admin/* endpoints.

## Files / Packages Changed

None yet. Planned scope: @nestrum/admin. Introduce only packages needed by this phase.

## Tests

Session/access-denial matrix, same-origin and allowed-origin behavior, metadata visibility, and CRUD for a resource with public API disabled.

## Acceptance Criteria

- [ ] Unauthorized users cannot access admin API
- [ ] admin.access is default-deny
- [ ] Same-origin is enforced by default
- [ ] Metadata discovery works
- [ ] Admin CRUD works without public API
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
