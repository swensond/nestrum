# PM1.5 — Nestrum Dev

## Status

Not Started

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

Planned: config → validation → contracts/Prisma artifacts → metadata/Zod → resource validation → application startup → watcher/admin development serving.

Own backend/admin child processes, cleanup, and repeated edit handling. Surface generation/startup errors with model/database/app/source identity where available, and recover on subsequent edits. Report actual API/admin/OpenAPI URLs; the current OpenAPI route is `/api/openapi.json`.

For schema changes, report:

```text
Schema changed.

Database "default" may require migration.

Run:
  nestrum db migrate --database default
```

Do not apply migrations. Keep existing explicit database workflow requirements.

## Public API

Planned `nestrum dev`, development environment/host/port resolution, watch categories, admin development routes, and diagnostics. Document implemented defaults/options when complete.

## Files / Packages Changed

Planned: `packages/cli` development orchestrator/watch/diagnostics, reusable build/runtime seams, admin-ui dev integration, example scripts/configuration, [architecture](../../architecture.md), and runtime phase/index documentation.

## Tests

Start with one command; edit TypeScript and verify changed HTTP behavior. Edit Prisma and verify regeneration/resource validation before restart. Edit configuration and verify a full restart. Exercise admin development assets/custom component edits, generation-error recovery, process cleanup, and the no-implicit-migration invariant.

## Acceptance Criteria

- [ ] Application starts with one command.
- [ ] Backend TypeScript change restarts app.
- [ ] Prisma change triggers appropriate regeneration.
- [ ] Config change triggers full restart.
- [ ] Admin development flow works.
- [ ] Errors are framework-aware.
- [ ] Schema changes report migration guidance without mutating databases.
- [ ] Documentation describes implemented development behavior.

## Validation

Run targeted watcher/restart and admin development tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, and `pnpm check`. Include applicable Svelte/browser checks, verify generated files do not trigger loops, and record `git diff --check`.

## Known Limitations

Backend updates initially restart the process. Watch debounce/coalescing and frontend HMR details must be documented based on actual implementation. No migration opt-in or new validation CLI is required.

## Follow-Ups

[PM1.6](phase-06-hardening.md) proves process lifecycle reliability, repeated edits, startup failures, and end-to-end shutdown.

## Completion Notes

Pending implementation and validation.
