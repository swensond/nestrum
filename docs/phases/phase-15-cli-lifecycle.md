# Phase 15 — Nestrum DB CLI and Lifecycle Hardening

## Status

Not Started

## Goal

Own the public database workflow and harden deterministic bootstrap/shutdown.

## Scope

- Implement nestrum db generate, nestrum db migrate, and nestrum db status.
- Allow named database targeting to fit the multi-database contract, such as --database documents.
- Delegate internally to Prisma initially where appropriate.
- Add provider extension seams for compression, indexes, extensions, partitioning, and physical options.
- Harden the final lifecycle ordering recorded in architecture.md, including stopping traffic before reverse app shutdown, DI disposal, and database disconnect.

## Out of Scope

Advanced storage implementations, distributed transactions, scaffolding/dev CLI commands, and publishing automation.

## Architecture Decisions

Follow the locked contracts in [architecture](../architecture.md). Exact implementation interfaces remain to be settled during this phase; record durable changes there and rationale in an ADR when needed.

## Implementation

Not implemented. The scope and public API below are planned targets, not available behavior.

## Public API

Planned executable nestrum; db generate/migrate/status commands; provider extension contracts. See architecture.md for the complete conceptual bootstrap and shutdown ordering.

## Files / Packages Changed

None yet. Planned scope: @nestrum/cli, @nestrum/core, @nestrum/prisma. Introduce only packages needed by this phase.

## Tests

CLI configuration/database selection and delegated command errors, deterministic bootstrap sequencing, reverse shutdown/cleanup order, and extension seam behavior.

## Acceptance Criteria

- [ ] Nestrum DB CLI works
- [ ] Normal workflow needs no direct Prisma CLI
- [ ] Lifecycle order is deterministic
- [ ] Shutdown order is tested
- [ ] Provider extension seam exists
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
