# PM1.5 — Nestrum Dev

## Status

Complete (backend loop; admin frontend HMR not implemented)

## Goal

Provide one self-contained development command using the same application definition as production.

## Scope

- Implement `nestrum dev` config loading, development environment, framework generation/validation, startup, and watcher ownership.
- Restart the backend on application TypeScript/configuration changes.
- Regenerate contracts, Prisma artifacts, metadata, and Zod after Prisma changes before resource revalidation/restart.
- Serve or proxy Svelte/Vite admin development assets, retaining `/admin` where practical.
- Provide app/resource/database counts, URLs, watch state, and framework-aware errors.
- Report schema changes that may need explicit migration.

## Out of Scope

Sophisticated backend HMR, automatic migrations, `--migrate` opt-in, automatic app discovery, and changes to production `serve` semantics.

## Architecture Decisions

Depends on the build/configuration seams in [PM1.3](phase-03-build.md) and serving composition in [PM1.4](phase-04-serve.md). Prefer complete backend restart for correctness. Use the shared runtime adapter and lifecycle rather than an application-owned server. Preserve admin session/ABAC/origin boundaries during proxying.

Classify changes so application TypeScript restarts without unnecessary Prisma regeneration; Prisma edits regenerate and revalidate; config edits perform a full development restart. Pure custom Svelte component edits should use frontend HMR without backend restart where practical. Exclude generated output from watch loops.

## Implementation

`nestrum dev [--config <path>] [--host <h>] [--port <n>]` (`packages/cli/src/dev.ts`; shared seams `generateArtifacts`, `validateResources`, `loadBuiltConfig` extracted from `build.ts`):

- **Environment.** Establishes `NESTRUM_ENV=development`; a conflicting value fails. Host/port use the same flag → env → config → default precedence as `serve` (default `127.0.0.1:3000`).
- **Cycle.** Each cycle compiles the sources with esbuild to a fresh `.nestrum/dev/server-<n>.mjs` (a new file per cycle defeats the ESM module cache, so a restart runs new application code in the same process), loads the configuration, and starts the application through the same `createHonoRuntime` + `@nestrum/runtime-node` path as `serve`. Stale bundles are deleted. `.nestrum/dev/` is separate from the production build.
- **Regeneration only when needed.** The assembled per-database Prisma source is hashed each cycle. If a database's schema changed (or the configuration changed), contracts, metadata, and Zod schema families are regenerated and resources are revalidated against a separate application instance before the served instance starts. Unchanged schemas skip Prisma emission.
- **Migration guidance, never migration.** A changed database prints `Schema changed. Database "<name>" may require migration. Run: nestrum db migrate --database <name>`; no database is contacted by generation or validation.
- **Watching.** Recursive `fs.watch` over the project root. `nestrum.config.*` → full restart with regeneration; `.prisma` and application `.ts/.mts/.js/.mjs/.json` → restart (regeneration via the schema hash); `.svelte` → logged, no backend restart. `node_modules`, `.nestrum`, `.git`, `dist`, `.svelte-kit`, `coverage`, and `.tmp-*` are ignored, so generated output cannot cause loops. Edits are debounced (default 100 ms) and coalesced; edits during a restart schedule one more.
- **Errors.** Compile, configuration, schema, resource, and startup failures print `<ErrorName>: <CODE>: <message>` (source file/line for compile errors), leave the server stopped, and the session recovers on the next edit.
- **Diagnostics.** Prints version, app/resource/database counts, API/Admin/OpenAPI URLs (`/api/openapi.json`), and watch state.
- **Shutdown.** `SIGINT`/`SIGTERM` close the session (drain, app shutdown, DI, databases, listener). A restart uses a 5 s drain timeout.

Deviations from the plan: restart happens in-process rather than in owned child processes, and the admin is the prebuilt shell served at `/admin`; there is no Vite dev server, proxy, or Svelte HMR, so custom admin component edits do not take effect under `dev`.

## Public API

`nestrum dev`; `runDev`, `DevSession` (`url`, `changed`, `idle`, `close`), and `classifyChange` from `@nestrum/cli`.

## Files / Packages Changed

`packages/cli` (`dev.ts`, refactored `build.ts`, `bin.ts`), [architecture](../../architecture.md), and runtime phase/index documentation.

## Tests

Start with one command; edit TypeScript and verify changed HTTP behavior. Edit Prisma and verify regeneration/resource validation before restart. Edit configuration and verify a full restart. Exercise admin development assets/custom component edits, generation-error recovery, process cleanup, and the no-implicit-migration invariant.

## Acceptance Criteria

- [x] Application starts with one command.
- [x] Backend TypeScript change restarts app.
- [x] Prisma change triggers appropriate regeneration.
- [x] Config change triggers full restart.
- [ ] Admin development flow works (only the prebuilt shell is served; no Vite/HMR).
- [x] Errors are framework-aware.
- [x] Schema changes report migration guidance without mutating databases.
- [x] Documentation describes implemented development behavior.

## Validation

Validated: nine dev tests (classification/ignore rules, one-call startup and diagnostics, TypeScript edit changes served behavior, Prisma edit regenerates and prints migration guidance, config edit restarts with new host, compile-error reporting and recovery, burst coalescing, real filesystem events, environment conflict) pass repeatedly. No Svelte/browser or database checks were run.

## Known Limitations

Backend updates restart the application in-process. Watch debounce/coalescing and frontend HMR details must be documented based on actual implementation. No migration opt-in or new validation CLI is required.

## Follow-Ups

[PM1.6](phase-06-hardening.md) proves process lifecycle reliability, repeated edits, startup failures, and end-to-end shutdown.

## Completion Notes

Pending implementation and validation.
