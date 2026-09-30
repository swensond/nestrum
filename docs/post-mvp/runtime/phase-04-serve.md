# PM1.4 — Nestrum Serve

## Status

Complete (database-backed auth/admin end to end not exercised)

## Goal

Run a previously built application in production with `nestrum serve`, without user-written HTTP bootstrap.

## Scope

- Read the production manifest, validate compatibility/required artifacts, and load the compiled application.
- Resolve host/port with CLI → environment → config → framework-default precedence and establish production environment.
- Initialize databases, InferDI, Better Auth, resources, managers, and policies.
- Register public Hono routes, private admin API, and built Svelte admin assets.
- Complete app lifecycle/readiness before starting the Node adapter.
- Integrate shutdown ownership and startup rollback; leave detailed hardening to PM1.6.

## Out of Scope

Watching, HMR, TypeScript transpilation, Prisma/Zod regeneration, development error pages/tooling, silent builds, and implicit migrations.

## Architecture Decisions

Depends on [PM1.3](phase-03-build.md) and [PM1.2](phase-02-node-runtime.md). CLI orchestrates `@nestrum/runtime-node` rather than implementing a listener. Preserve configuration/resource validation before configure hooks, route/admin validation before ready hooks, and reverse app → DI → database cleanup after traffic drains.

`serve` remains production regardless of conflicting development environment settings. Authentication, `admin.access`, and same-origin restrictions remain mandatory for `/__admin/*`. Health/readiness responses must not reveal configuration or credentials.

## Implementation

`nestrum serve [--config <path>] [--host <h>] [--port <n>]` (`packages/cli/src/serve.ts`, `runtime-options.ts`):

1. Establish `NESTRUM_ENV=production`. An explicit different value fails with `CLI_ENVIRONMENT_CONFLICT`.
2. Read and verify the manifest: version, installed Nestrum version, entry SHA-256, and every declared contract/metadata artifact. Missing/incompatible/stale/incomplete builds fail with `BUILD_NOT_FOUND`, `BUILD_INCOMPATIBLE`, `BUILD_STALE`, or `BUILD_INCOMPLETE` and always say `Run: nestrum build`. `serve` never builds. The project root is the working directory (or the directory of `--config`); the source configuration file is not read.
3. Import the compiled `.nestrum/server/index.mjs` and pass it through `defineCliConfig`.
4. Resolve host/port as flag → `HOST`/`PORT` → configuration `server` → defaults (`127.0.0.1`, `3000`). Invalid ports fail with `CLI_SERVER_OPTIONS_INVALID`.
5. If the manifest declares an admin, import `<package>/node` and create the admin shell (mounted at `/admin`; the private API remains `/__admin/*` behind Better Auth, `admin.access`, and same-origin checks in the existing Hono runtime).
6. `createHonoRuntime(...).start()` runs the existing application lifecycle: `prepare`, managed database connects, resource initialization, Better Auth, `configure` hooks, admin/auth/public route registration, then `ready` hooks. Startup failure rolls back through the existing runtime.
7. Only then `nodeRuntime.serve(runtime, { host, port })` binds the listener. If binding fails, the runtime is shut down before the error is rethrown.
8. `RunningServer.shutdown()` (memoized; wired to `SIGINT`/`SIGTERM` by the command) calls `runtime.shutdown()`, whose `stopTraffic` hook is the adapter's `stopAccepting`, then drains, shuts down apps, disposes DI, disconnects databases, and finally closes the listener.

No watcher, compiler, Vite, regeneration, or migration code is reachable from `serve`.

Application-owned model loading remains. The application still supplies Prisma clients, `databaseLifecycle`, and `resourceModels` (typically `prepare`); a framework-owned loader from the build's metadata artifacts is a follow-up. The build tests show an application loading `resourceModels` from `.nestrum/generated/models/*.json`, so serving performs no generation.

## Public API

`nestrum serve`; `runServe`, `RunningServer`, `resolveServerOptions`, and `establishEnvironment` from `@nestrum/cli`. Defaults: host `127.0.0.1`, port `3000`. Admin UI stays `/admin/*`; private API stays `/__admin/*`.

## Files / Packages Changed

`packages/cli` (serve, runtime options, arguments, bin), `packages/cli/package.json` dependencies on `@nestrum/hono`, `@nestrum/runtime`, `@nestrum/runtime-node`, `@nestrum/zod`, [architecture](../../architecture.md), and runtime phase/index documentation.

## Tests

Start a built example through the compiled CLI. Exercise public API, admin UI/API, and Better Auth login/session behavior. Verify no listener before readiness, partial startup cleanup, option precedence, missing/incompatible artifact errors, and absence of compiler/watcher/Vite/regeneration/migration behavior.

## Acceptance Criteria

- [x] A built application starts with `nestrum serve` (a scratch project with a resource; the repository example needs Postgres/Mongo and was not run).
- [x] No user server/bootstrap source required.
- [x] Public API works.
- [ ] Admin UI works (not exercised: needs a database-backed auth/admin application).
- [ ] Admin API works (not exercised, as above).
- [ ] Better Auth works (not exercised, as above).
- [x] No development tooling is loaded.
- [x] Missing builds fail with build guidance and no automatic build.
- [x] Documentation describes implemented production behavior.

## Validation

Validated: serve tests (build→serve→public OpenAPI/404→ordered shutdown, missing build, no listener after a failing `ready` hook, environment conflict, precedence) pass; the compiled CLI was run by hand (`build`, `serve --port` beating `PORT`, missing-build and `NESTRUM_ENV` errors, SIGTERM closing the listener). Database-backed public CRUD, Better Auth login, and the admin UI/API were not run because this environment has no database services.

## Known Limitations

Compatibility requires an identical manifest version and Nestrum version. The three unchecked criteria above are unverified here, not known failures. Development orchestration is PM1.5; complete signal/drain/health/stale-build integration is PM1.6.

## Follow-Ups

[PM1.5](phase-05-dev.md) provides the development command. [PM1.6](phase-06-hardening.md) tests shutdown, health/readiness, and deployment lifecycle end to end.

## Completion Notes

Pending implementation and validation.
