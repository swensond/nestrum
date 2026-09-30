# PM1.2 — Node Runtime Adapter

## Status

Not Started

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

Planned. Implement listener creation, Fetch dispatch, host/port handling, startup failure cleanup, and asynchronous close. Specify the distinction between ceasing acceptance, draining active requests, and final closure so later CLI shutdown can preserve app/DI/database ordering.

## Public API

Planned Node adapter implementation of `RuntimeAdapter` and corresponding `ServerHandle`. Document actual bound-address behavior and lifecycle guarantees when implemented.

## Files / Packages Changed

Planned: `packages/runtime-node`, necessary workspace wiring, [architecture](../../architecture.md), [initiative index](README.md), and this phase record. Change portable contracts only if required by the concrete adapter.

## Tests

Serve a test Nestrum/Hono application over real local HTTP. Verify Fetch request/response behavior, host/port configuration, listener startup failure cleanup, and clean closure without leaked listeners. Cover a pending request to establish draining behavior. Confirm `@nestrum/runtime` remains Node-free.

## Acceptance Criteria

- [ ] Test Nestrum application serves over HTTP.
- [ ] Hono requests work.
- [ ] Configurable host/port work.
- [ ] Runtime closes cleanly.
- [ ] Runtime-neutral package remains Node-free.
- [ ] Documentation describes the implemented adapter.

## Validation

Run targeted real HTTP tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, and `pnpm check`; verify compiled exports and `git diff --check`. Record results before marking Complete.

## Known Limitations

No production manifest loading or development orchestration yet. Request cancellation, drain deadlines, and repeated signal behavior are finalized and integrated in PM1.6.

## Follow-Ups

[PM1.3](phase-03-build.md) prepares production artifacts; [PM1.4](phase-04-serve.md) orchestrates this adapter; [PM1.6](phase-06-hardening.md) hardens shutdown.

## Completion Notes

Pending implementation and validation.
