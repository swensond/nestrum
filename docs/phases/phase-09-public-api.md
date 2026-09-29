# Phase 9 — Opt-In Public Resource API and OpenAPI

## Status

Not Started

## Goal

Generate public CRUD and OpenAPI only for explicitly enabled resource operations.

## Scope

- Generate GET collection, GET /:id, POST collection, PATCH /:id, and DELETE /:id under /api.
- Use generated input Zod validation, QuerySets, ABAC, Prisma, and generated Read response validation.
- Generate OpenAPI from the same metadata with @hono/zod-openapi.
- Exclude disabled operations and api: false resources.

## Out of Scope

Arbitrary Prisma select/include, nested writes, Better Auth, and admin.

## Architecture Decisions

Follow the locked contracts in [architecture](../architecture.md). Exact implementation interfaces remain to be settled during this phase; record durable changes there and rationale in an ADR when needed.

## Implementation

Not implemented. The scope and public API below are planned targets, not available behavior.

## Public API

Planned: defineResource({ model, api: { list, retrieve, create, update, delete } }); generated /api/projects routes.

## Files / Packages Changed

None yet. Planned scope: @nestrum/hono. Introduce only packages needed by this phase.

## Tests

Route matrix, absent routes for admin-only resources, invalid input/output handling, authorization/scoping, and OpenAPI operation parity.

## Acceptance Criteria

- [ ] Enabled operations generate routes
- [ ] Disabled operations generate no routes
- [ ] Admin-only resource has no public route
- [ ] Zod validation works
- [ ] ABAC works
- [ ] OpenAPI matches enabled operations
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
