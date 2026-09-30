# Phase 1 — Application and App Lifecycle

## Status

Complete

## Goal

Implement the Django-style application and explicitly installed-app model.

## Scope

- Implement defineApplication(), defineApp(), AppRegistry, and Application.
- Declare app name, dependsOn, configure(), ready(), and shutdown().
- Reject invalid names, duplicate names, missing dependencies, and dependency cycles.
- Start in deterministic topological order and shut down in reverse order.
- Await hooks, guard lifecycle transitions, and clean up partial startup failures.

## Out of Scope

Databases and every later subsystem. No DI, HTTP, automatic process signal handling, or filesystem app discovery.

## Architecture Decisions

The graph is validated eagerly and is immutable after construction. Ordering uses depth-first traversal in registration/dependency declaration order. All configure hooks precede all ready hooks. Shutdown is sequential in reverse order. Completed calls are idempotent; overlapping calls and restart are rejected. See [ADR 0002](../decisions/0002-application-lifecycle.md).

## Implementation

defineApp() copies/freezes definitions and dependency arrays. AppRegistry copies definitions again, validates the entire graph, and exposes has, get, and all. Unknown lookups and graph errors have explicit codes; cycles include their path. Duplicate dependency references are harmless and execute once.

Application owns state, a registry, and a frozen hook context. Definition does not invoke hooks. Startup awaits all configure hooks followed by all ready hooks; shutdown awaits the reverse order. Apps without hooks and empty app lists are valid.

Phase 2 compatibility update: application configuration now requires databases.default, and hook context also exposes databases. Existing lifecycle tests supply a valid database definition; lifecycle ordering and state semantics are unchanged.

Startup failure cleans up only apps whose configure phase was entered, including the failing app. Ready failure cleans up all configured apps. Cleanup continues after errors. AppLifecycleError exposes appName, hook, and the original cause. Startup plus rollback failure produces APPLICATION_START_FAILED with an AggregateError cause; shutdown failures produce APPLICATION_SHUTDOWN_FAILED with all hook errors. Once cleanup is attempted, it is not automatically repeated.

## Public API

```ts
import { defineApp, defineApplication } from '@nestrum/core';
import { prismaDatabase } from '@nestrum/prisma';

const users = defineApp({ name: 'users' });
const projects = defineApp({
    name: 'projects',
    dependsOn: ['users'],
    configure({ apps }) {
        apps.get('users');
    },
    async ready() {},
    async shutdown() {}
});

const application = defineApplication({
    apps: [projects, users],
    databases: { default: prismaDatabase({ provider: 'postgresql', connection: 'postgresql://localhost/nestrum' }) }
});
application.apps.all(); // users, projects
await application.start();
await application.shutdown();
```

Exports: defineApp, defineApplication, AppRegistry, Application, AppError, AppRegistryError, AppLifecycleError, and the types AppContext, AppDefinition, AppHook, AppHookName, ApplicationConfig, ApplicationState. The Phase 0 FRAMEWORK_NAME marker remains available.

Registry definitions/lists are readonly and frozen. get(name) throws APP_NOT_FOUND if absent; has(name) returns a boolean. Names must be nonempty with no leading/trailing whitespace.

Lifecycle state behavior:

| State | start() | shutdown() |
| --- | --- | --- |
| created | Configure, then ready | Stop without hooks |
| starting | Reject | Reject |
| ready | No-op | Reverse shutdown |
| stopping | Reject | Reject |
| stopped | Reject | No-op |
| failed | Reject | Stop without repeating rollback |

Invalid transitions reject with APPLICATION_STATE_INVALID. A failed start leaves failed; a completed shutdown leaves stopped even when cleanup errors are reported. Restart requires a fresh instance. Shutdown hooks must handle partial initialization safely.

## Files / Packages Changed

- packages/core/src/application/application.types.ts: app, config, context, hook, and state shapes.
- packages/core/src/application/application.errors.ts: coded error base, graph and hook errors.
- packages/core/src/application/app.ts: app definition snapshot.
- packages/core/src/application/app-registry.ts: validation, lookup, topological ordering.
- packages/core/src/application/application.ts: awaited lifecycle and cleanup.
- packages/core/src/index.ts: public exports.
- packages/core/tests/application.test.ts: graph and lifecycle tests.
- README.md, architecture, MVP, phase/documentation indexes, and lifecycle ADR.

No new package or dependency was introduced.

## Tests

29 focused tests cover explicit registration/lookup, invalid and duplicate names, missing dependencies, self/indirect cycles, stable ordering with shared/repeated dependencies, independent app ordering, immutable snapshots, and empty registries. Lifecycle tests cover pre-hook validation, configure/ready barrier, context, async hook awaiting, reverse shutdown, optional hooks, idempotence, invalid/overlapping operations, partial configure rollback, ready failure rollback, aggregate rollback errors, and continuing shutdown after failures. The Phase 0 smoke test remains green (30 tests total).

## Acceptance Criteria

- [x] Apps register explicitly
- [x] Duplicate names fail
- [x] Missing dependencies fail
- [x] Cycles fail
- [x] Startup ordering is deterministic
- [x] Shutdown reverses dependency order
- [x] Lifecycle hooks are covered by Vitest
- [x] Phase documentation and final validation are complete

## Validation

```bash
pnpm test
pnpm typecheck
pnpm check
pnpm build
```

Passed on 2026-09-29 using Node v26.10.0, pnpm 12.6.0, TypeScript 7.0.2, and Vitest 5.0.2:

- pnpm test: 30 tests across two files passed.
- pnpm typecheck: passed with source, tests, and configuration included.
- pnpm check: tests, typecheck, and build passed.
- pnpm build: passed within check; ESM and declarations emitted.
- Built @nestrum/core public exports imported in Node; application/registry/error exports and dependency-ordered startup/reverse shutdown passed smoke validation.
- All 17 phase documents retain the required headings; local links across 26 Markdown documents resolve.

## Known Limitations

No live database or server lifecycle exists yet; Phase 2 adds database configuration registration. App registration is fixed at construction; overlapping operations are rejected rather than queued. Cancellation and in-place restart are not supported. Shutdown hooks are attempted once, including after partial configuration; failure reports unsuccessful cleanup and requires application-specific recovery. Topological traversal is recursive; unusually deep graphs may reach the JavaScript stack limit.

## Follow-Ups

Proceed to [Phase 2: Named Database Registry](phase-02-databases.md). Phase 15 will harden the full lifecycle with traffic, DI, and database disposal as those subsystems exist. No additional post-MVP feature was needed for Phase 1.

## Completion Notes

Phase 1 is complete. Only the app/lifecycle abstraction was introduced in this phase; no dependencies or later-phase packages were added at that point. The example and compatibility note now reflect Phase 2's required database configuration; see the phase index for current progress.

Current integration evidence (2026-09-30): [Phase 16](phase-16-integration.md) now verifies real Docker PostgreSQL/Mongo contracts, migrations, resources, auth, admin forms/browser flows, and shutdown. Earlier phase-specific fixture results remain historical evidence. Atomic object-policy writes still deny and remain an unmet required MVP follow-up.
