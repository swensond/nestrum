# PM4.3 — Development Integration

## Status

Not Started

## Goal

Extend `nestrum dev` to coordinate backend, consumer Svelte, and admin Svelte development under one command.

## Scope

- Start/restart backend and consumer Vite/Svelte server from `nestrum dev`.
- Proxy consumer routes/assets while preserving API/admin/runtime namespaces.
- Provide client HMR for pure frontend edits.
- Avoid unnecessary backend restart for pure frontend changes.
- Own child-process startup, diagnostics, and cleanup.

## Out of Scope

Production build/serve, consumer auth/API helpers, SSR, automatic migrations, and sophisticated backend HMR.

## Architecture Decisions

Depends on [PM4.2](phase-02-build.md) and planned PM1.5 orchestration. Nestrum owns the user-facing process; Vite is internal. Proxying must not bypass Better Auth, same-origin, private admin, or runtime boundaries.

## Implementation

Planned child-process coordination, proxy route table, port discovery, and diagnostics. Backend changes follow PM1 restart behavior; pure consumer edits use Vite HMR where practical. Admin development remains distinct.

## Public API

Planned `nestrum dev` web behavior, proxy/base-path options, and diagnostics.

## Files / Packages Changed

Planned CLI/dev/web integration, example config/scripts, tests, architecture, initiative index, and this record.

## Tests

Start one command and verify backend + consumer + admin availability, client HMR, backend restart on server changes, no restart on pure frontend edits, route proxy boundaries, and child cleanup.

## Acceptance Criteria

- [ ] One command starts backend and consumer UI.
- [ ] Client HMR works.
- [ ] Pure frontend edits do not unnecessarily restart backend.
- [ ] Admin and consumer routes remain distinct.
- [ ] Docs updated.

## Validation

Run watcher/proxy tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, browser checks, and `git diff --check`.

## Known Limitations

Backend edits use full restart per PM1. SSR and alternate frontend servers remain deferred.

## Follow-Ups

[PM4.4](phase-04-auth-api.md) adds consumer auth and public API helpers.

## Completion Notes

Pending implementation and validation.
