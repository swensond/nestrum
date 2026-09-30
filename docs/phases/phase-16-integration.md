# Phase 16 — MVP Integration and Architecture Test

## Status

In Progress

## Goal

Prove fresh resources work end-to-end without changing framework internals.

## Scope

- Use PostgreSQL default.Project and MongoDB documents.Article if verified Prisma 8/runtime support permits.
- Provide independent managers/policies and generated Zod for both databases.
- Enable admin for both, public API for one, and no public API for the other.
- Exercise app dependencies and configured auth database placement.
- Add fresh resources exclusively through application-owned code and contracts.
- Bring every phase document current and mark MVP complete only when all criteria pass.

## Out of Scope

Post-MVP features and masking provider blockers as successful integration.

## Architecture Decisions

If Prisma 8/provider/runtime support prevents Mongo or SQL proof, record the exact blocker and leave the phase and MVP incomplete rather than substituting mock-only acceptance.

## Implementation

Implemented in application-owned workspace packages:

- `apps/example` contributes `default.Project` (PostgreSQL, public/admin CRUD) and `documents.Article` (MongoDB, admin-only), separate managers/owner policies, generated Zod composition, field overrides, and archive actions.
- `identity` is a separate PostgreSQL auth database. Better Auth's protected models and server-owned `staff` extension are generated and migrated there. Public signup cannot grant staff. Apps start in `nestrum.auth → projects → articles` order.
- Preparation assembles/emits real contracts, constructs native clients, compiles metadata/Zod, and binds QuerySets. Database lifecycle callbacks connect and close those application-owned clients.
- Prisma 8 rc.13 allows one facade per generated-artifact package. `example-postgres` and `example-mongo` provide separate public runtime imports and artifact locations. Native Mongo fields use `_id` ObjectId strings; the application Mongo binding rewrites public AST parameters with metadata codec hints so ObjectId equality filters reach the database correctly. No Nestrum package changes were needed.
- Compose deploys PostgreSQL 17 and MongoDB 8 with healthchecks and ephemeral loopback ports. The repeatable runner uses unique projects/artifacts, applies migrations through the compiled Nestrum CLI, sends actual HTTP requests to the compiled Hono/admin shell, and removes its containers, volumes, and artifacts in `finally`.
- The example's Node host only forwards Fetch requests. No manual Hono routes, OpenAPI definitions, or resource-specific Svelte pages were added.

The integration implementation is validated. The phase remains In Progress because the previously documented required MVP atomic object-policy mutation gate is still unmet; the safe existing denial is retained.

## Public API

No new primary framework abstraction is planned: integrate existing public interfaces in example apps.

## Files / Packages Changed

`apps/example`, `apps/example-postgres`, `apps/example-mongo`, root integration script/lockfile, README, architecture/workflow/MVP records, and all phase records. Existing framework packages are unchanged.

## Tests

The Docker-backed runner checks real contract/type emission and migrate/plan/status for all three databases; dependency order and auth placement; protected signup, persisted staff/session login/logout; missing/member/foreign-origin admin denials; schema and ownership denials; scoped managers/counts, including ObjectId-filtered Mongo counts; public SQL and private Mongo create/read/update/delete; admin-only route/OpenAPI absence; generic Svelte SSR list/detail and native HTML create/update/action/delete forms; reverse shutdown and traffic gating.

A live Chrome check also verified login, SQL/Mongo navigation and persisted lists, Mongo edit/save, archive, and logout against the same Docker deployment. Browser checks are supplementary; the default runner needs no browser or Playwright installation.

## Acceptance Criteria

- [x] Fresh resources are added without changing Nestrum packages
- [x] No manual Hono route file is added
- [x] No manual OpenAPI code is added
- [x] No resource-specific Svelte page is added
- [x] SQL resource works
- [x] Mongo resource works
- [x] Admin-only resource works
- [x] Public resource works
- [x] Full tests/checks pass
- [ ] docs/mvp.md is marked complete only after validation — held open by the required atomic object-policy write follow-up from Phases 7/9; real integration is now proven.
- [x] All phase docs reflect actual implementation

## Validation

```bash
pnpm check
pnpm test:integration
pnpm exec biome check .
git diff --check
```

Validated on 2026-09-30: `pnpm check` passed 393 tests across 21 files, root TypeScript and native Svelte checking (zero errors/warnings), all package builds, and compiled admin UI/CLI verification. The Docker integration runner passed all three live migration workflows, real auth/CRUD/manager/ABAC/Svelte form checks, reverse app/database shutdown, and post-shutdown 503 gating. The live Chrome checks above passed. No mocked provider proof or success-on-skip behavior is used.

## Known Limitations

Atomic object-policy update/delete remain fail-closed; scoped writes work. Earlier records explicitly require atomic object mutation orchestration within MVP, so MVP is not marked complete. This integration does not replace that requirement with a mock, non-atomic read/write sequence, or an implicit post-MVP deferral.

The pinned generic Mongo adapter emits codec-free filter parameters; the example's application-owned binding supplies native codec hints. A general framework solution should accept model/codec metadata rather than guess from strings. Prisma generation requires provider-separated facade packages. Mongo auth placement is not claimed: auth is proven on the configured PostgreSQL `identity` database. Standalone MongoDB is sufficient for this scoped CRUD proof; cross-database or Mongo transaction guarantees are not claimed. Explicit caller-supplied IDs keep the fragments small; the frozen legacy Project authoring example remains covered by Phase 4 compatibility tests.

## Follow-Ups

Finish atomic object-policy mutation orchestration under its own provider-safe design and validation before closing the MVP gate. Keep the requirement in [post-MVP](../post-mvp.md) explicitly identified as remaining MVP work. General Mongo adapter codec binding is also recorded there.

## Completion Notes

Fresh SQL/Mongo integration is implemented and verified using Docker, entirely through application-owned code and existing public framework seams. The remaining MVP gate is recorded explicitly; Phase 16 and MVP are not represented as fully complete.
