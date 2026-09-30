# PM1.2 — Node Runtime Adapter

## Status

Complete

## Goal

Provide the first real HTTP runtime through `@nestrum/runtime-node`.

## Scope

- Create `packages/runtime-node` implementing the portable adapter.
- Integrate Node HTTP serving with Hono's Fetch interface.
- Honor configurable host/port, surface startup/bind failures, and close cleanly.
- Establish stopping-new-traffic and active-request draining foundations.
- Wire package exports, build, checking, and real HTTP tests.

## Out of Scope

Development watchers, production build loading, CLI commands, non-Node adapters, and final cross-process signal/timeout hardening.

## Architecture Decisions

Depends on [PM1.1](phase-01-runtime-adapter.md). Node listener APIs stay here, outside core, the portable runtime package, and CLI. Compose socket/listener ownership with existing Hono request-scope draining; do not create a second application shutdown owner. The listener receives an application that has completed required readiness work.

## Implementation

Added `packages/runtime-node` (`@nestrum/runtime-node`). `nodeRuntime` implements `RuntimeAdapter` with `node:http` `createServer` and `getRequestListener` from `@hono/node-server` (pinned 1.19.9) converting Node requests to the application's Fetch handler.

- `serve` validates options (non-empty host, integer port 0–65535), listens, and resolves once bound. Bind failures (e.g. `EADDRINUSE`) reject with the original error and leave no listener.
- The handle reports the actual bound port, so port `0` works.
- `stopAccepting()` stops the listener synchronously and closes idle keep-alive connections; in-flight requests continue.
- `close()` calls `stopAccepting()` and resolves only after every connection has ended, so pending requests finish first. Both operations are idempotent.
- The adapter does not own application shutdown; the orchestrator composes `stopAccepting` (as `stopTraffic`) with Hono request-scope draining, app shutdown, DI disposal, and database disconnects.
- Drain deadlines and forced termination are deliberately absent (PM1.6).

## Public API

`@nestrum/runtime-node` exports `nodeRuntime: RuntimeAdapter`.

## Files / Packages Changed

`packages/runtime-node` (new), `vitest.workspace.ts`, `pnpm-lock.yaml`, [architecture](../../architecture.md), [initiative index](README.md), and this phase record. Portable contracts were unchanged.

## Tests

Serve a test Nestrum/Hono application over real local HTTP. Verify Fetch request/response behavior, host/port configuration, listener startup failure cleanup, and clean closure without leaked listeners. Cover a pending request to establish draining behavior. Confirm `@nestrum/runtime` remains Node-free.

## Acceptance Criteria

- [x] Test Nestrum application serves over HTTP.
- [x] Hono requests work.
- [x] Configurable host/port work.
- [x] Runtime closes cleanly.
- [x] Runtime-neutral package remains Node-free.
- [x] Documentation describes the implemented adapter.

## Validation

Validated: 7 real-HTTP Vitest tests pass (Hono routing, POST bodies, fixed port, bind failure, option validation, pending-request draining, idempotent close/port release); `tsc --noEmit` clean; `pnpm -r build` compiles the package; biome clean.

## Known Limitations

No production manifest loading or development orchestration yet. Request cancellation, drain deadlines, and repeated signal behavior are finalized and integrated in PM1.6.

## Follow-Ups

[PM1.3](phase-03-build.md) prepares production artifacts; [PM1.4](phase-04-serve.md) orchestrates this adapter; [PM1.6](phase-06-hardening.md) hardens shutdown.

## Completion Notes

PM1.2 ships the Node listener only; no CLI consumes it yet. [PM1.3](phase-03-build.md) is next.
