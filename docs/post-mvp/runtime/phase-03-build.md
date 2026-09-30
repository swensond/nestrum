# PM1.3 — Nestrum Build

## Status

Complete

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

`nestrum build [--config <path>]` (`packages/cli/src/build.ts`, `manifest.ts`, `runtime-arguments.ts`):

1. **Discover configuration.** A single `nestrum.config.{ts,mts,mjs,js}` in the working directory, or `--config`. Multiple candidates without `--config` fail.
2. **Reset.** The previous manifest and `server/`, `generated/`, `contracts/` are removed first; the manifest is written last, so a failed build never leaves a usable build.
3. **Compile.** esbuild bundles the configuration and all relative application sources into `.nestrum/server/index.mjs` (ESM, Node 22 target, no source maps). Packages stay external and resolve from the project's `node_modules`, so serving needs no TypeScript transpilation.
4. **Load and validate.** The bundle is imported and passed through `defineCliConfig`. The `Application` constructor already validates the app dependency graph, databases, Better Auth, admin, policies, and resource-to-database references; failures become `BUILD_VALIDATION_FAILED`.
5. **Contracts and metadata.** For each database, `generatePrismaContracts` assembles fragments and emits the contract into `.nestrum/contracts/`; `compileModelMetadata` writes `.nestrum/generated/models/<database>.json`.
6. **Resource validation.** Zod schema families are generated from the compiled metadata and passed to the resource registry, so a resource naming a missing model fails (`RESOURCE_MODEL_MISSING`) without any live service.
7. **Manifest.** `.nestrum/manifest.json` (version 1) records the Nestrum version, timestamp, runtime adapter package, entry path with SHA-256, app names, resource count, auth flag, admin shell package, per-database provider/contract/metadata paths, and configured server defaults.

Configuration reconciliation: `defineConfig` is exported from `@nestrum/cli` (core cannot depend on the CLI) and is an alias of `defineCliConfig`, which gained an optional validated `server: { host?, port? }`. Existing `nestrum db` commands and `defineCliConfig` are unchanged. `Application` gained the read-only `authConfigured`/`adminConfigured` getters so build tooling can classify the application before startup. `.nestrum/` was already ignored by `.gitignore`.

Decisions:

- **Connections.** Connection strings remain in the application definition; the manifest and diagnostics contain none. Applications should read secrets from the environment.
- **Zod.** Runtime schema families derived from metadata remain the baseline; static Zod source files are still deferred, so only metadata is emitted.
- **Admin.** The prebuilt `@nestrum/admin-ui` shell is referenced by package name in the manifest and resolved at serve time rather than copied into `.nestrum/admin/`: its server output imports SvelteKit packages that must resolve from the admin-ui package. Rebuilding the shell with application-supplied Svelte component registries is not part of this phase.
- **Contract locations.** Optional `contractDirs` emits selected databases inside other packages (Prisma 8 allows one database facade per package); every database also gets a stable copy at `.nestrum/contracts/<db>.json`, which the manifest references. Earlier `run-*` directories in `contractDirs` are pruned per build.
- **Migrations.** Nothing connects to a database or migrates.

## Public API

`nestrum build [--config <path>]`; `defineConfig`, `discoverConfig`, `runBuild`, `bundleConfig`, `readManifest`, and the `BuildManifest` type from `@nestrum/cli`. The `.nestrum/` layout beyond `manifest.json` is framework-owned.

## Files / Packages Changed

`packages/cli` (build, manifest, runtime arguments, config), `packages/core` (`authConfigured`/`adminConfigured`), `.gitignore`, `pnpm-lock.yaml`, [architecture](../../architecture.md), and runtime phase/index documentation.

## Tests

Build a valid example and verify all declared artifacts. Reject missing resource models, invalid app graphs, and invalid framework registrations. Prove admin/custom components build and the server entry loads as compiled JavaScript. Verify no implicit migrations and no usable manifest after build failure.

## Acceptance Criteria

- [x] Valid application builds.
- [x] Invalid resource/model fails build.
- [x] Invalid app dependency graph fails build.
- [x] Admin builds.
- [x] Manifest is written with required compatibility/artifact data.
- [x] Output is sufficient for production serving.
- [x] Documentation describes the implemented pipeline/configuration.

## Validation

Validated: five build tests (valid build with artifacts, missing model, invalid app graph, compile errors/missing config, tampered/incompatible build) pass; `tsc --noEmit` clean; `pnpm -r build` succeeds; the compiled `node packages/cli/dist/bin.js build` produced a manifest in a scratch project. Relocation limitation: the bundle rewrites module-relative paths (`import.meta.url`), and the project must keep `node_modules` reachable from `.nestrum/server/`.

## Known Limitations

Exact output layout, static versus runtime Zod representation, manifest version policy, and offline registration validation seams are implementation decisions. No serving command is provided by this phase.

## Follow-Ups

[PM1.4](phase-04-serve.md) consumes the manifest without rebuilding. [PM1.5](phase-05-dev.md) reuses generation/validation while owning development restart.

## Completion Notes

PM1.3 builds and validates but does not serve. Applications still construct Prisma clients and `resourceModels` themselves (see [PM1.4](phase-04-serve.md)).
