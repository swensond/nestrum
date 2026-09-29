# Phase 12 — Prebuilt Svelte Admin Shell

## Status

Not Started

## Goal

Build a prebuilt metadata-driven Svelte 5/SvelteKit admin shell.

## Scope

- Use TypeScript 7, Svelte 5, SvelteKit, svelte-check-native, and Vitest.
- Implement generic /admin, /admin/[resource], /admin/[resource]/new, and /admin/[resource]/[id] routes.
- Drive navigation entirely from admin API metadata.
- Provide shell/loading/error/session boundary behavior needed for generic routes.

## Out of Scope

Resource-specific Svelte page generation, generic CRUD implementation (Phase 13), and polished design.

## Architecture Decisions

Follow the locked contracts in [architecture](../architecture.md). Exact implementation interfaces remain to be settled during this phase; record durable changes there and rationale in an ADR when needed.

## Implementation

Not implemented. The scope and public API below are planned targets, not available behavior.

## Public API

Planned generic Svelte route shell and metadata client; ordinary resources contribute no dedicated pages.

## Files / Packages Changed

None yet. Planned scope: @nestrum/admin-svelte. Introduce only packages needed by this phase.

## Tests

Shell and metadata navigation tests with one and two resources; build and native Svelte checking.

## Acceptance Criteria

- [ ] Svelte admin builds with TypeScript 7
- [ ] svelte-check-native passes
- [ ] Navigation is metadata-driven
- [ ] Adding a second admin resource updates navigation automatically
- [ ] No resource-specific page is required
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
