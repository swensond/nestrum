# Implementation phases

Phases 0–8 are complete; Phases 9–16 are not started. Each task should introduce one primary abstraction or integrate two existing abstractions, and leave the repository green.

| Phase | Goal | Packages | Status |
| --- | --- | --- | --- |
| [0 — Workspace and Documentation Foundation](phase-00-workspace.md) | Create a clean pnpm workspace and durable documentation foundation for bounded future implementation sessions. | root, @nestrum/core | Complete |
| [1 — Application and App Lifecycle](phase-01-application.md) | Implement the Django-style application and explicitly installed-app model. | @nestrum/core | Complete |
| [2 — Named Database Registry](phase-02-databases.md) | Introduce named Prisma-backed databases and a required default without full contract generation. | @nestrum/core, @nestrum/prisma | Complete |
| [3 — Prisma 8 Multi-File Contract Assembly](phase-03-prisma-contracts.md) | Allow apps and framework modules to contribute Prisma fragments independently per database. | @nestrum/prisma | Complete |
| [4 — Prisma Metadata Compiler and Framework-Owned Zod](phase-04-zod-generation.md) | Compile Prisma 8 metadata into Nestrum model metadata and baseline generated Zod schema families. | @nestrum/prisma, @nestrum/zod | Complete |
| [5 — Resource System](phase-05-resources.md) | Register metadata-driven resources backed by validated models and generated schemas. | @nestrum/core | Complete |
| [6 — QuerySets and Managers](phase-06-querysets.md) | Provide immutable Prisma-backed QuerySets as the standard access layer. | @nestrum/core, @nestrum/prisma | Complete |
| [7 — ABAC Engine](phase-07-abac.md) | Implement default-deny resource/action authorization with database collection scopes. | @nestrum/core, @nestrum/prisma | Complete |
| [8 — Hono and InferDI Runtime Integration](phase-08-hono-runtime.md) | Create the request-scoped HTTP runtime before authentication. | @nestrum/hono | Complete |
| [9 — Opt-In Public Resource API and OpenAPI](phase-09-public-api.md) | Generate public CRUD and OpenAPI only for explicitly enabled resource operations. | @nestrum/hono | Not Started |
| [10 — Framework-Owned Better Auth](phase-10-auth.md) | Make Better Auth a built-in subsystem with owned Prisma 8 contracts and adapter. | @nestrum/auth | Not Started |
| [11 — Admin Backend Boundary](phase-11-admin-backend.md) | Create the private admin API independently of public API exposure. | @nestrum/admin | Not Started |
| [12 — Prebuilt Svelte Admin Shell](phase-12-admin-shell.md) | Build a prebuilt metadata-driven Svelte 5/SvelteKit admin shell. | @nestrum/admin-svelte | Not Started |
| [13 — Generic Svelte Admin CRUD](phase-13-admin-crud.md) | Deliver usable generic list/create/edit/delete without per-resource Svelte code. | @nestrum/admin-svelte | Not Started |
| [14 — Admin Extensibility and Arbitrary Actions](phase-14-admin-extensions.md) | Add admin overrides, custom components, and ABAC-backed arbitrary actions. | @nestrum/admin, @nestrum/admin-svelte | Not Started |
| [15 — Nestrum DB CLI and Lifecycle Hardening](phase-15-cli-lifecycle.md) | Own the public database workflow and harden deterministic bootstrap/shutdown. | @nestrum/cli, @nestrum/core, @nestrum/prisma | Not Started |
| [16 — MVP Integration and Architecture Test](phase-16-integration.md) | Prove fresh resources work end-to-end without changing framework internals. | all; @nestrum/testing and example apps as needed | Not Started |

## Session inputs

Read architecture.md, mvp.md, and the current phase record. Include the phase goal, current interfaces/layout, scope exclusions, required tests, validation commands, and documentation updates in each bounded session. Split large phases into sub-sessions when needed.

## Completion requirements

Every record uses Status, Goal, Scope, Out of Scope, Architecture Decisions, Implementation, Public API, Files / Packages Changed, Tests, Acceptance Criteria, Validation, Known Limitations, Follow-Ups, and Completion Notes. Valid statuses are Not Started, In Progress, Complete, and Blocked.

Run `pnpm test`, `pnpm typecheck`, `pnpm check`, and applicable builds. Svelte phases also run `svelte-check-native`; high-level integration may run Playwright. Mark complete only after implementation and checks pass, actual behavior is documented, and deferred work is recorded.
