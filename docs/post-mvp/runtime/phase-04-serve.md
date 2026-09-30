# PM1.4 — Nestrum Serve

## Status

Not Started

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

Planned startup: manifest → compatibility/artifact validation → built application → database/DI/auth/registration initialization → route/admin mounting → app readiness → HTTP listener.

Missing build must fail without attempting to build:

```text
NestrumError:
No production build found.

Run:
  nestrum build
```

Before traffic, validate application/database configuration, Prisma clients, app graph, resources, QuerySets/managers, policies, Better Auth, and admin. Reject incompatible or incomplete builds with actionable rebuild guidance.

## Public API

Planned `nestrum serve`, including `--host`/`--port` handling and `HOST`, `PORT`, `NESTRUM_ENV` behavior. Document exact defaults/options/errors after implementation. Admin UI stays `/admin/*`; private API stays `/__admin/*`.

## Files / Packages Changed

Planned: `packages/cli` serving/manifest/config integration, runtime-node lifecycle integration, required bootstrap/admin seams, example scripts/configuration, [architecture](../../architecture.md), and runtime phase/index documentation.

## Tests

Start a built example through the compiled CLI. Exercise public API, admin UI/API, and Better Auth login/session behavior. Verify no listener before readiness, partial startup cleanup, option precedence, missing/incompatible artifact errors, and absence of compiler/watcher/Vite/regeneration/migration behavior.

## Acceptance Criteria

- [ ] Built example starts with `nestrum serve`.
- [ ] No user server/bootstrap source required.
- [ ] Public API works.
- [ ] Admin UI works.
- [ ] Admin API works.
- [ ] Better Auth works.
- [ ] No development tooling is loaded.
- [ ] Missing builds fail with build guidance and no automatic build.
- [ ] Documentation describes implemented production behavior.

## Validation

Run targeted compiled production startup tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, and `pnpm check`. Use applicable database/browser integration for API/auth/admin behavior; record readiness/rollback evidence and `git diff --check`.

## Known Limitations

Production accepts only builds compatible with the implemented manifest policy. Development orchestration is PM1.5; complete signal/drain/health/stale-build integration is PM1.6.

## Follow-Ups

[PM1.5](phase-05-dev.md) provides the development command. [PM1.6](phase-06-hardening.md) tests shutdown, health/readiness, and deployment lifecycle end to end.

## Completion Notes

Pending implementation and validation.
