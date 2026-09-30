# Phase 0 — Workspace and Documentation Foundation

## Status

Complete

## Goal

Create a clean pnpm workspace and durable documentation foundation for bounded future implementation sessions.

## Scope

- Create packages/core, root package.json, pnpm-workspace.yaml, tsconfig.base.json, and vitest.workspace.ts.
- Configure TypeScript 7, strict checking, ESM, Node, and Vitest.
- Provide build, test, test:watch, typecheck, and check scripts.
- Create the complete docs structure, frozen MVP, deferred scope, locked architecture, and every initial phase record.

## Out of Scope

Hono, Prisma integration, Better Auth, Svelte, QuerySets, ABAC, and application lifecycle.

## Architecture Decisions

Use pnpm 12.6.0, TypeScript 7.0.2, and Vitest 5.0.2. Compile ESM under strict NodeNext resolution to ES2022, emitting declarations. Core has no ambient Node types; root test/config checking includes Node types. The requested vitest.workspace.ts is imported into the current test.projects API. See [the tooling decision](../decisions/0001-workspace-tooling.md).

## Implementation

Implemented the root tooling configuration and core package scaffold. Vitest uses test.projects with an explicitly imported vitest.workspace.ts list. Package output is dist/index.js and dist/index.d.ts with maps; tests are excluded from emitted output. Root typecheck covers source, tests, and Vitest configuration. Root check runs tests, typecheck, and build. All required validation passed.

## Public API

Only `FRAMEWORK_NAME = 'Nestrum'` is exported by @nestrum/core. This is a scaffold marker, not a framework API.

## Files / Packages Changed

Root tooling files, README.md, .gitignore, .editorconfig, pnpm-lock.yaml, packages/core, and docs.

## Tests

One Vitest smoke test imports the core TypeScript ESM entry point. Build and runtime smoke validation verify emitted ESM. Root type checking includes source, tests, and Vitest configuration.

## Acceptance Criteria

- [x] pnpm workspace installs cleanly
- [x] TypeScript 7 is used
- [x] Trivial core build works
- [x] Vitest executes successfully
- [x] Root validation scripts work
- [x] Required docs structure exists
- [x] MVP and post-MVP scope are documented
- [x] All 17 phase docs exist
- [x] This phase reflects actual implementation

## Validation

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm check
pnpm build
```

Passed on 2026-09-29 using Node v26.10.0 and pnpm 12.6.0:

- pnpm install and pnpm install --frozen-lockfile succeeded.
- pnpm build emitted core ESM, declarations, and maps.
- pnpm test passed one smoke test in the @nestrum/core project.
- pnpm typecheck passed with TypeScript 7.0.2.
- pnpm check passed tests, typecheck, and build.
- pnpm test:watch passed its initial run and entered watch mode; the script explicitly uses --watch so agent/CI detection does not silently select run mode.
- The built package imported through its @nestrum/core exports in Node and returned the expected marker.
- Documentation verification found all 17 phase records, every required phase heading, and no broken local links across 25 Markdown files.

The initial sandboxed install could not resolve registry DNS; the authorized install succeeded. Frozen-lockfile verification used the shared pnpm store. Fully offline installation is not an acceptance guarantee.

## Known Limitations

Only a scaffold core marker is exported. No framework subsystem is implemented. No lint/format tool or CI pipeline is introduced in this phase.

## Follow-Ups

Next is [Phase 1: Application and App Lifecycle](phase-01-application.md). No new deferred MVP work arose. Add new packages and test projects only as their phases require them; review root typecheck coverage as new runtime targets are introduced.

## Completion Notes

Phase 0 is complete. The full documentation foundation exists, and all required checks passed. Current Vitest projects are used via an explicit import of the requested workspace file; this tooling adaptation is recorded in the ADR. At Phase 0 completion, Phases 1–16 were planned and unimplemented; see the phase index for current progress.

Current integration evidence (2026-09-30): [Phase 16](phase-16-integration.md) now verifies real Docker PostgreSQL/Mongo contracts, migrations, resources, auth, admin forms/browser flows, and shutdown. Earlier phase-specific fixture results remain historical evidence. Atomic object-policy writes still deny and remain an unmet required MVP follow-up.
