# PM1.3 — Nestrum Build

## Status

Not Started

## Goal

Implement `nestrum build` to produce validated artifacts sufficient for production serving.

## Scope

- Discover `nestrum.config.ts` and finalize the application configuration entry contract.
- Validate application/database configuration and the explicit app dependency graph.
- Assemble per-database Prisma contracts and generate required Prisma artifacts, immutable model metadata, and Zod artifacts as appropriate.
- Validate resources, QuerySets/managers, ABAC, Better Auth, and admin registration.
- Compile the server entry and build the Svelte admin, including explicit custom component registries.
- Produce `.nestrum/manifest.json` and ensure `.nestrum/` is automatically ignored by source control.

## Out of Scope

HTTP serving, development watching, implicit migrations, filesystem app discovery, and a new `nestrum check` command.

## Architecture Decisions

Follows the contract in [PM1.0](phase-00-runtime-contract.md) and adapter phases [PM1.1](phase-01-runtime-adapter.md)/[PM1.2](phase-02-node-runtime.md). Build output must allow `serve` without TypeScript transpilation or schema generation. Keep connection credentials out of emitted artifacts/diagnostics. Define relocation and dependency requirements explicitly because existing Prisma artifacts may reference generated/package paths.

Separate build-time validation from live database connection and runtime hook execution. Reconcile proposed `defineConfig` with current `defineApplication` and `defineCliConfig`, including explicit connection resolution and compatibility with database commands. Do not regress existing lifecycle/registration validation.

## Implementation

Planned pipeline: config → application/app graph validation → contracts → Prisma artifacts → metadata → Zod → resource/manager/policy/auth/admin validation → server build → admin build → manifest publication.

Define the initial versioned manifest with runtime adapter, entry module, admin assets, database/app identities, artifact locations, framework/build compatibility data, and timestamp as needed. Required artifacts must be complete before a manifest is published; failed builds must not appear usable.

## Public API

Planned `nestrum build`, application configuration contract, `.nestrum/` output, and production manifest schema. Internal artifact layout remains framework-owned. Document supported options and defaults when implemented.

## Files / Packages Changed

Planned: `packages/cli` build/config integration, required core/Prisma/Zod/admin-ui build seams, ignore rules, example configuration/scripts as appropriate, [architecture](../../architecture.md), and runtime phase/index documentation.

## Tests

Build a valid example and verify all declared artifacts. Reject missing resource models, invalid app graphs, and invalid framework registrations. Prove admin/custom components build and the server entry loads as compiled JavaScript. Verify no implicit migrations and no usable manifest after build failure.

## Acceptance Criteria

- [ ] Valid application builds.
- [ ] Invalid resource/model fails build.
- [ ] Invalid app dependency graph fails build.
- [ ] Admin builds.
- [ ] Manifest is written with required compatibility/artifact data.
- [ ] Output is sufficient for production serving.
- [ ] Documentation describes the implemented pipeline/configuration.

## Validation

Run targeted build/manifest tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, and `pnpm check`. Include applicable native Svelte checks and compiled artifact verification. Record output/relocation limitations and `git diff --check` results.

## Known Limitations

Exact output layout, static versus runtime Zod representation, manifest version policy, and offline registration validation seams are implementation decisions. No serving command is provided by this phase.

## Follow-Ups

[PM1.4](phase-04-serve.md) consumes the manifest without rebuilding. [PM1.5](phase-05-dev.md) reuses generation/validation while owning development restart.

## Completion Notes

Pending implementation and validation.
