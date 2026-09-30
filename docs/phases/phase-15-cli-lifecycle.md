# Phase 15 — Nestrum DB CLI and Lifecycle Hardening

## Status

Complete

## Goal

Own the public database workflow and harden deterministic bootstrap/shutdown.

## Scope

- Implement nestrum db generate, nestrum db migrate, and nestrum db status.
- Allow named database targeting to fit the multi-database contract, such as --database documents.
- Delegate internally to Prisma initially where appropriate.
- Add provider extension seams for compression, indexes, extensions, partitioning, and physical options.
- Harden the final lifecycle ordering recorded in architecture.md, including stopping traffic before reverse app shutdown, DI disposal, and database disconnect.

## Out of Scope

Advanced storage implementations, distributed transactions, scaffolding/dev CLI commands, and publishing automation.

## Architecture Decisions

Nestrum owns config/targeting and delegates pinned Prisma 8 commands. Generation/planning are offline; migrations have stable per-database paths while contracts retain fresh run directories. Credentials travel through the child environment. Portable application barriers place route registration before ready and DI disposal before disconnect, including rollback. See [ADR 0013](../decisions/0013-database-workflow-and-lifecycle.md).

## Implementation

The compiled @nestrum/cli executable validates arguments/config, loads native TypeScript/ESM config, targets named databases, emits contracts, plans offline migrations, applies reviewed migrations, and reports live migration status. Generated provider configs inherit authoring/extensions and durable migration paths. Delegation uses argument arrays, timeouts, connection redaction, and preserved failure exits. Generation/planning never start apps or managed database connections.

Prisma assembly accepts explicit provider extension descriptors with owner/name/database/provider, source contributors and/or provider control modules. Duplicate names, mismatches, and invalid contributions fail. Provenance/native validation are retained. No advanced physical storage feature was added.

Application prepare runs before managed connects/resource loading/configure. Connect follows database declaration order; disconnect reverses entered connects, including partial failures. Routes/OpenAPI mount before ready hooks. Shutdown gates traffic, stops the host, drains request cleanup, reverses apps, disposes DI, and disconnects databases. Cleanup continues after failures without retries. Optional removable Node signal handlers prevent overlapping shutdown. Drain timeout retains active resources for safe later shutdown retry.

## Public API

Commands: `nestrum db generate`, `nestrum db migrate --plan --name initial`, `nestrum db migrate`, and `nestrum db status`. Options include --database, --config, --json, and repeatable --confirm tokens for applying migrations. Defaults are database default and nestrum.config.ts.

`defineCliConfig({ application, rootDir?, outputDir?, migrationsDir?, authoring?, extensions?, timeoutMs? })` supplies an unstarted application. CLI exports typed parsing/loading/execution and installShutdownSignals. Core exports DatabaseLifecycle/ApplicationLifecycle and adds prepare/databaseLifecycle configuration plus beforeReady/afterApps startup callbacks. Hono adds stopTraffic/drainTimeoutMs and optional di.dispose. Prisma's Node entry exports PrismaProviderExtension and workflow command/config helpers. See [database workflow](../database-workflow.md) for usage/ownership.

## Files / Packages Changed

New packages/cli owns executable/config/parser/delegation/signals, tests, and compiled verification. Core adds portable lifecycle barriers/managed cleanup; Hono adds pre-ready route registration, DI/host/drain ordering; Prisma adds selected assembly, provider source/control seams, reusable ORM config, and command helpers. Workspace scripts/lockfile/Vitest wire the eighth package and its production verification. Documentation adds workflow, ADR, architecture/seam updates, and completion records.

## Tests

CLI tests cover parsing/config, target isolation/no startup, stable migrations, offline/online delegation, consent forwarding, safe output/exit codes, and signal removal/non-overlap. Provider tests cover selected paths/provenance, native extended emission, descriptor/contributor failure, and credential-free configs. Core/Hono cover prepare/connect/configure/routes/ready, partial connections, pre-ready failure, reverse cleanup/error aggregation, exact-once disposal/disconnect, host gating, timeout, and retry.

Compiled executable checks load real TypeScript config, emit PostgreSQL/MongoDB contracts, create native offline plans for both, reject unknown targeting, and report unreachable status safely. Existing compiled admin integration also passes under the hardened lifecycle.

## Acceptance Criteria

- [x] Nestrum DB CLI works
- [x] Normal workflow needs no direct Prisma CLI
- [x] Lifecycle order is deterministic
- [x] Shutdown order is tested
- [x] Provider extension seam exists
- [x] Documentation is updated

## Validation

```bash
pnpm test
pnpm typecheck
pnpm check
pnpm build
```

Passed: pnpm check (393 tests across 21 files, strict typecheck, native Svelte checker with zero errors/warnings, all eight package builds, compiled admin integration, and compiled CLI checks); pnpm exec nestrum --help; formatting and git diff --check. Workspace dependencies installed offline without new external dependencies.

## Known Limitations

Live migration application/successful status on real SQL/Mongo belongs to Phase 16; native offline plans and delegation/failure contracts are verified here. Advanced storage and generic plugin command discovery are excluded. Config needs erasable TypeScript or compiled ESM. Clients/resource factories remain application-provided; lifecycle callbacks establish ownership without inferring clients. Streaming/detached work and universal socket cancellation remain outside bounded request ownership. Drain timeout keeps active resources open until requests finish/cancel and shutdown is retried. Existing object-policy mutations remain fail-closed.

## Follow-Ups

Phase 16 proves live database/resource/auth/admin integration with fresh SQL/Mongo apps, explicit bindings, and this lifecycle. Advanced storage/plugin discovery/broader hosts remain [post-MVP](../post-mvp.md).

## Completion Notes

Phase 15 is complete. Database commands need no user-authored Prisma workflow config; deterministic route/ready and shutdown/rollback barriers are implemented and tested. MVP completion remains gated on Phase 16.

Current integration evidence (2026-09-30): [Phase 16](phase-16-integration.md) now verifies real Docker PostgreSQL/Mongo contracts, migrations, resources, auth, admin forms/browser flows, and shutdown. Earlier phase-specific fixture results remain historical evidence. Atomic object-policy writes still deny and remain an unmet required MVP follow-up.
