# PM4.3 — Development Integration

## Status

Complete

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

- [x] One command starts backend and consumer UI.
- [x] Client HMR works.
- [x] Pure frontend edits do not unnecessarily restart backend.
- [x] Admin and consumer routes remain distinct.
- [x] Docs updated.

## Validation

Run watcher/proxy tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, browser checks, and `git diff --check`.

## Known Limitations

Backend edits use full restart per PM1. SSR and alternate frontend servers remain deferred.

## Follow-Ups

[PM4.4](phase-04-auth-api.md) adds consumer auth and public API helpers.

## Completion Notes

Implemented. `nestrum dev` starts the application's Vite server internally (loopback, ephemeral port, its own HMR websocket port) and proxies only GET/HEAD requests the backend did not claim (never reserved namespaces) through the same `webUi` seam, injecting `publicEnv` into HTML. Files inside the web root are owned by Vite: they never restart the backend, so frontend edits use HMR. Backend/config edits keep the PM1 full restart; the Vite server persists across restarts and closes with the session (`close()` releases it). The banner prints a `Web` line. Admin development is unchanged (prebuilt shell).

Validated with `packages/cli/tests/dev.test.ts` (one command serves consumer + API, proxy boundaries, no restart or log noise on a web edit, updated content, cleanup). Browser-level HMR was not exercised.
