# PM1.6 — Runtime Hardening

## Status

Implemented; awaiting `pnpm test:integration` on a machine with Docker. The initiative is **not** marked complete until that passes.

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

- **Health and readiness** (`packages/cli/src/health.ts`, used by `serve` and `dev`). `GET|HEAD /__nestrum/health` returns `200 {"status":"ok"}` while the process is serving, including during draining. `GET|HEAD /__nestrum/ready` returns `200 {"status":"ready"}` only when bootstrap finished and shutdown has not begun, otherwise `503 {"status":"unavailable"}`. Other methods return 405. Responses are `no-store` and disclose nothing else. The routes are handled before the application and are not configurable or disableable yet.
- **Readiness transitions.** The listener binds only after `runtime.start()` succeeds, so readiness is true from the first accepted connection; `shutdown()` flips it to false before stopping traffic.
- **Signals.** The first `SIGINT`/`SIGTERM` starts the ordered shutdown (stop accepting → drain → reverse app shutdown → DI disposal → database disconnect → close listener). A repeated signal, or a shutdown that fails (for example at the drain deadline), prints a message and exits with status 1 immediately. Signal handlers are installed once per process and never stack.
- **Drain deadline.** `server.drainTimeoutMs` (default 30000) bounds waiting for requests in the Hono runtime. On expiry shutdown fails with `HTTP_RUNTIME_DRAIN_TIMEOUT`, resources deliberately stay open (nothing still in use is disposed), the listener is not awaited, and the command exits 1. `dev` restarts use a 5 s deadline.
- **Startup rollback.** Failures during application startup roll back through the existing lifecycle (configured apps' `shutdown` hooks run, DI is disposed, managed databases disconnect); the listener is never bound. A bind failure after readiness shuts the runtime down before rethrowing.
- **Stale and missing builds.** A build is usable only if the manifest exists, its manifest and Nestrum versions match, the entry file's SHA-256 matches the manifest, and every declared contract/metadata artifact exists. Anything else fails with a `BUILD_*` code and `Run: nestrum build`. Source timestamps are deliberately not consulted: `serve` need not have sources. Nothing is built, generated, or migrated automatically.
- **Production isolation.** `serve` loads only the manifest, the compiled entry, the Hono runtime, the Node adapter, and (when configured) the prebuilt admin package; it imports no watcher, esbuild build path, Vite, or generation code at runtime beyond what module imports of `@nestrum/cli` already contain, exposes no source maps, and adds no diagnostic endpoints.

## Public API

`/__nestrum/health`, `/__nestrum/ready`, `server.drainTimeoutMs`, `withHealth`, `HEALTH_PATH`, `READY_PATH`, and `installShutdownSignals`' new `onRepeat` option.

## Files / Packages Changed

`packages/cli` (health, serve, dev, signals, config, `bin`, `tooling/verify-build.mjs`), [architecture](../../architecture.md), [roadmap](../../post-mvp.md), and all runtime phase/index documentation.

## Tests

Prove these workflows through real processes and HTTP:

```text
build → serve → HTTP request → signal → drain → shutdown
dev → edit source → restart → HTTP response sees new behavior
```

Cover health/readiness, active requests, deadlines, repeated signals, startup failures/partial cleanup, missing/stale builds, app/DI/database reverse cleanup, and child-process/listener cleanup. Verify public API, Better Auth, admin API/UI, and production isolation with no manual example HTTP bootstrap.

## Acceptance Criteria

- [x] Graceful shutdown is tested for SIGINT and SIGTERM.
- [x] Active requests drain within documented configured behavior.
- [x] Health endpoint works.
- [x] Readiness reflects lifecycle correctly.
- [x] Startup failure cleans up partially initialized subsystems.
- [x] Stale/missing build errors are useful.
- [x] Build/serve/request/shutdown integration passes.
- [x] Dev/edit/restart/request integration passes.
- [x] No manual server bootstrap exists in the normal example (`server.mjs`/`host.mjs` removed; `nestrum.config.mjs` + `nestrum build/serve/dev`).
- [ ] Production exposes no development tooling (no such endpoints or modules are loaded; awaiting the Docker integration run).
- [x] Database migrations remain explicit.
- [x] Documentation is updated.
- [ ] Every item in the [initiative definition of done](README.md#37-definition-of-done) passes and the initiative is marked complete.

## Validation

Validated: in-process tests for health/readiness, readiness dropping while an in-flight request still completes, rollback hooks, and the drain deadline; `pnpm --filter @nestrum/cli verify:build` runs the compiled CLI as real processes (`build` → `serve` → health/ready over HTTP → `SIGTERM` and separately `SIGINT` → exit code 0 with the port closed, plus missing-build guidance); a manual compiled `nestrum dev` session was run (start, source edit changing the HTTP response, Prisma edit, `SIGINT` exit). This environment has no Docker daemon and no MongoDB, so the full integration run could not be executed here. What was run against the migrated example: `nestrum build` (3 apps, 2 resources, 3 databases, auth, admin; dummy connections, no database contact); `nestrum db generate/migrate --plan/migrate/status` against a local PostgreSQL 16 for `default` and `identity`; and `nestrum serve`, which loaded the built bundle, read the emitted contracts, created the clients, and reached the database-connect step (it then failed on the deliberately unreachable MongoDB and rolled back). The Auth/ABAC/CRUD/admin HTTP assertions in `apps/example/tooling/integration.mjs` were rewritten but not executed.

## Known Limitations

**Still open:** (1) run `pnpm test:integration` (needs Docker) and fix anything it finds in the rewritten runner; (2) the admin shell under `dev` is the prebuilt one (no Vite/HMR); (3) applications still read emitted contracts and build Prisma clients themselves (the example does this in `prepare`), and module-relative paths inside the bundle refer to the bundle location, so application code locates artifacts via `new URL('../contracts/<db>.json', import.meta.url)`. Non-Node runtimes remain deferred. Describe any streaming/detached-work/cancellation constraints and deployment dependency/artifact requirements demonstrated by the final implementation.

## Follow-Ups

Run the migrated example against Docker databases (required to close this initiative). Record remaining optional adapters, health route configurability, advanced escape hatches, and `nestrum check` in the post-MVP roadmap. Do not mark required runtime functionality complete through deferral.

## Completion Notes

The example was migrated to the framework-owned lifecycle. Changes this forced: `contractDirs` (per-database emission directories, needed because Prisma 8 allows one database facade per package), a stable `contracts/<db>.json` per build, a uniform `dev/server/` layout, `@nestrum/admin-ui` as a CLI dependency (found missing by the local serve run), and CLI errors printing their message for runtime commands. The initiative stays incomplete until the database-backed criteria pass.
