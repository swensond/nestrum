# PM1.6 — Runtime Hardening

## Status

Not Started

## Goal

Make `dev` and `serve` reliable framework-owned process lifecycles and verify the initiative end to end.

## Scope

- Handle `SIGINT`/`SIGTERM`, repeated signals, graceful shutdown, and active request draining.
- Implement minimal health/readiness endpoints and correct readiness transitions.
- Harden startup rollback, listener failures, missing/stale/incompatible builds, and development/production diagnostics.
- Verify compiled build/serve and development edit/restart workflows.
- Remove normal application-owned HTTP bootstrap from the example.
- Update all documentation to actual behavior and mark the initiative complete only after its definition of done passes.

## Out of Scope

Official Bun/Deno/Cloudflare support, implicit migrations, sophisticated backend HMR, full plugin infrastructure, and optional future `nestrum check`/migration opt-ins.

## Architecture Decisions

Depends on [PM1.1](phase-01-runtime-adapter.md) through [PM1.5](phase-05-dev.md). Preserve shutdown order: stop accepting traffic → drain requests → reverse app shutdown → dispose DI → disconnect databases → final runtime close. Define bounded drain timeout/cancellation and cleanup-error behavior without disposing infrastructure still used by active requests. Avoid overlapping shutdown owners and leaked signal handlers.

Health means alive; readiness means successful bootstrap, required database/framework initialization, and completed app ready hooks. Initial startup never accepts traffic before readiness. Readiness must drop on shutdown; startup failures never become ready.

## Implementation

Planned endpoints are `/__nestrum/health` and `/__nestrum/ready`, with minimal responses. Configuration/disablement may be added later. Ensure production exposes no development pages, inspectors, Vite/watcher endpoints, development metadata, or source maps unless configured.

Missing/stale/incompatible builds produce actionable guidance and never trigger automatic build/generation/migration. Document the implemented stale-build definition and compatibility policy rather than assuming timestamps alone establish validity.

## Public API

Planned health/readiness routes, signal/close/drain guarantees, startup/build errors, and diagnostics. Record final timeout/options/status semantics after implementation.

## Files / Packages Changed

Planned: `packages/runtime`, `packages/runtime-node`, `packages/cli`, required core/Hono lifecycle seams, integration fixtures, example configuration/scripts/bootstrap removal, [architecture](../../architecture.md), [roadmap](../../post-mvp.md), and all runtime phase/index documentation.

## Tests

Prove these workflows through real processes and HTTP:

```text
build → serve → HTTP request → signal → drain → shutdown
dev → edit source → restart → HTTP response sees new behavior
```

Cover health/readiness, active requests, deadlines, repeated signals, startup failures/partial cleanup, missing/stale builds, app/DI/database reverse cleanup, and child-process/listener cleanup. Verify public API, Better Auth, admin API/UI, and production isolation with no manual example HTTP bootstrap.

## Acceptance Criteria

- [ ] Graceful shutdown is tested for SIGINT and SIGTERM.
- [ ] Active requests drain within documented configured behavior.
- [ ] Health endpoint works.
- [ ] Readiness reflects lifecycle correctly.
- [ ] Startup failure cleans up partially initialized subsystems.
- [ ] Stale/missing build errors are useful.
- [ ] Build/serve/request/shutdown integration passes.
- [ ] Dev/edit/restart/request integration passes.
- [ ] No manual server bootstrap exists in the normal example.
- [ ] Production exposes no development tooling.
- [ ] Database migrations remain explicit.
- [ ] Documentation is updated.
- [ ] Every item in the [initiative definition of done](README.md#37-definition-of-done) passes and the initiative is marked complete.

## Validation

Run targeted process/HTTP lifecycle integration, `pnpm test`, `pnpm typecheck`, `pnpm build`, and `pnpm check`. Run applicable real database and browser integration. Record signal/drain/readiness/failure evidence, supported deployment assumptions, and `git diff --check` before marking Complete.

## Known Limitations

Non-Node runtimes remain deferred. Describe any streaming/detached-work/cancellation constraints and deployment dependency/artifact requirements demonstrated by the final implementation.

## Follow-Ups

Record remaining optional adapters, health route configurability, advanced escape hatches, and `nestrum check` in the post-MVP roadmap. Do not mark required runtime functionality complete through deferral.

## Completion Notes

Pending implementation and validation. The runtime initiative remains incomplete until all required phase criteria and definition-of-done items pass.
