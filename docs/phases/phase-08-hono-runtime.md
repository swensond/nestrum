# Phase 8 — Hono and InferDI Runtime Integration

## Status

Not Started

## Goal

Create the request-scoped HTTP runtime before authentication.

## Scope

- Bootstrap Hono and integrate InferDI.
- Provide isolated per-request DI and request environment.
- Expose application, databases, authorization, subject, and environment through request scope where needed.
- Map errors consistently and dispose scopes.
- Support anonymous subjects and avoid unnecessary Node-specific APIs in portable core.

## Out of Scope

Better Auth and generated public/admin routes.

## Architecture Decisions

Follow the locked contracts in [architecture](../architecture.md). Exact implementation interfaces remain to be settled during this phase; record durable changes there and rationale in an ADR when needed.

## Implementation

Not implemented. The scope and public API below are planned targets, not available behavior.

## Public API

Planned Hono bootstrap and request-scope integration; exact exported factory/context types are finalized in this phase.

## Files / Packages Changed

None yet. Planned scope: @nestrum/hono. Introduce only packages needed by this phase.

## Tests

Request isolation including concurrent requests, cleanup on success and failure, anonymous context, and consistent error responses.

## Acceptance Criteria

- [ ] Hono starts
- [ ] Each request gets an isolated InferDI scope
- [ ] Request scopes are disposed
- [ ] Errors map consistently
- [ ] Core remains runtime-portable in design
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
