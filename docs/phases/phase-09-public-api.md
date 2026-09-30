# Phase 9 — Opt-In Public Resource API and OpenAPI

## Status

Complete

## Goal

Generate public CRUD and OpenAPI only for explicitly enabled resource operations.

## Scope

- Generate enabled collection GET/POST and item GET/PATCH/DELETE under /api.
- Decode JSON input, validate composed generated schemas, and execute authorized QuerySets.
- Validate Read results and redact invalid database output as internal errors.
- Generate OpenAPI 3.1 from the same enabled route plan through @hono/zod-openapi.
- Leave disabled operations and admin-only resources absent from both routes and metadata.

## Out of Scope

Better Auth, admin, TCP hosting, automatic Prisma client creation, live database infrastructure, arbitrary public Where/select/include, nested writes, composite-key item routes, and advanced pagination.

## Architecture Decisions

See [architecture](../architecture.md) and [ADR 0010](../decisions/0010-public-api-transport-and-mutations.md).

Paths use kebab-case model names with regular plurals: Project → projects, ProjectMember → project-members, Category → categories. There is no irregular-noun dictionary. Default resources use /api/<plural-model>; named databases use /api/<database>/<plural-model>. Duplicate slugs and overlapping routes fail startup.

Item routes require one nonnullable, nonoptional scalar primary key. The URL parameter is id regardless of the actual field name. Missing/composite keys reject item API bootstrap; collection-only operations remain available. QuerySet.filterPrimaryKey validates and preserves the identity predicate even if a composed Where schema transforms its input. Authorization scopes remain separate conjunctive predicates.

GET uses read, POST create, PATCH update, and DELETE delete. PATCH/DELETE return 204 without an independently authorized secondary read. Per-object update/delete policies retain Phase 7's fail-closed restriction; scoped/resource-granted mutations work now. Atomic object-policy mutation support remains an MVP follow-up.

## Implementation

runtime.hono is OpenAPIHono. Phase 15 moves route planning/conflicts/OpenAPI/mounting to the application pre-ready barrier after configure. API bootstrap failure rolls back configured apps, disposes owned/opted-in DI, and disconnects managed databases before any ready hook or traffic. Cleanup failures aggregate; hooks are not repeated. See [Phase 15](phase-15-cli-lifecycle.md).

One route definition drives Hono registration and the OpenAPI registry. Handlers explicitly decode boundary values; QuerySets validate composed Create/Update schemas once against native values. Relation fields cannot be added to public write schemas. Read schema failures throw QUERY_RESULT_INVALID (500), retaining the original cause for server observers. Serialization failures use HTTP_RESPONSE_INVALID (500). Both redact internal details.

JSON transport uses decimal strings for bigint, ISO date-time strings for Date/Temporal.Instant, local date-time strings for PlainDateTime, and ISO date/time strings for PlainDate/PlainTime. Nullable/optional arrays preserve their shape. String-based date codecs remain strings. Temporal input uses a global implementation or explicit compatible factories; missing required factories fail bootstrap. Native runtime schemas remain authoritative.

Lists accept only limit (default 20, integer 0–100) and comma-separated orderBy, including a leading minus for descending fields. Zero still evaluates authorization. Unknown/repeated parameters, invalid ordering, and query parameters on other operations return 400. Writes require application/json, reject malformed/non-object bodies and unknown fields, and reject empty updates. No public Where/select/include/nested-write surface exists.

GET /api/openapi.json exists only when any public operation is enabled. runtime.getOpenApiDocument returns a copy after startup, including empty paths for an empty API. Manual Hono/OpenAPI registrations remain application-owned and are excluded from this generated snapshot. Conflict checks cover overlapping explicit-method manual routes; general middleware remains under application control.

## Public API

The existing Resource API remains unchanged:

```ts
import { defineResource } from '@nestrum/core';
import { createHonoRuntime } from '@nestrum/hono';

const ProjectResource = defineResource({
    model: 'Project',
    api: { list: true, retrieve: true, create: true, update: true, delete: true }
});
// Register ProjectResource, generated resourceModels with queryBackend, and policies.
const runtime = createHonoRuntime({ application });
await runtime.start();
const document = runtime.getOpenApiDocument();
const response = await runtime.fetch(new Request('http://localhost/api/projects?limit=20&orderBy=-createdAt'));
await runtime.shutdown();
```

application is the caller's configured application. Subjects are anonymous unless a trusted resolver supplies attributes. Better Auth remains Phase 10; applications still own clients/listeners.

| Operation | Route | Success | Policy action |
| --- | --- | --- | --- |
| list | GET /api/projects | 200, array of Read records | read |
| retrieve | GET /api/projects/:id | 200, Read record | read |
| create | POST /api/projects | 201, Read record | create |
| update | PATCH /api/projects/:id | 204, empty body | update |
| delete | DELETE /api/projects/:id | 204, empty body | delete |

Scoped item operations with no match return 404; invalid mutation counts return a redacted 500. Update schemas cannot expose primary-key changes. Input errors return 400, missing/denied grants 403, unsupported write media types 415, and unavailable runtime 503, using the existing error envelope.

For application-owned Temporal implementations, pass the same constructors used by generateModelSchemas to publicApi.temporal. Factories expose from(string): unknown:

```ts
const runtime = createHonoRuntime({
    application,
    publicApi: { temporal: { Instant, PlainDateTime, PlainDate, PlainTime } }
});
```

The constructors above are application-provided. PublicApiOptions, TemporalType, and PublicOpenApiDocument are exported types. QuerySet.filterPrimaryKey(value) is the supporting core method for unique identity selection.

## Files / Packages Changed

- @nestrum/hono: API planning, transport, OpenAPI runtime integration, rollback, exported types, and HTTP tests.
- @nestrum/core: filterPrimaryKey, typed Read-result failures, and focused QuerySet tests.
- Hono manifest/lockfile: @hono/zod-openapi 1.6.3; @nestrum/zod is a workspace dev dependency for generated-schema tests. Package imports and compiler conditions add #hono/* for cross-feature source/dist resolution.
- README, architecture, MVP/status indexes, deferred-work record, and ADR 0010.

No new package, auth subsystem, or admin subsystem was introduced.

## Tests

Tests use actual generated schema families and recording query backends. Coverage includes all CRUD/individual flags; private resources; equal model names across databases; Mongo ObjectId paths; bounds/ordering; strict/malformed input; Date/bigint and nullable/optional arrays; supplied Temporal; composed transforms; missing grants; resource/object denial; DB scopes; writes without read grants; preserved primary keys; invalid output; document parity/copy isolation; collisions; key constraints; and startup rollback/cleanup aggregation.

Earlier SQL/Mongo adapter tests still verify scoped predicates against emitted contracts and recording native executors. Live database proof remains Phase 16.

## Acceptance Criteria

- [x] Enabled operations generate routes
- [x] Disabled operations generate no routes
- [x] Admin-only resource has no public route
- [x] Zod validation works
- [x] ABAC works, retaining documented object-policy mutation denial
- [x] OpenAPI matches enabled operations
- [x] Documentation is updated

## Validation

```bash
pnpm test
pnpm typecheck
pnpm check
pnpm build
```

Validated on 2026-09-29:

- pnpm install --frozen-lockfile: passed.
- pnpm check: passed, executing pnpm test (264 tests in 12 files), pnpm typecheck, and pnpm build (four packages).
- Compiled ESM smoke: generated public route, disabled item route, OpenAPI, Fetch/shutdown, source/dist aliases, and empty public API passed.
- Compiled declaration consumer: TypeScript 7 NodeNext checking passed, including exact custom InferDI service types and PublicOpenApiDocument.
- Documentation QA: links, code fences, and every required phase heading passed across 34 Markdown files.
- git diff --check: passed.

## Known Limitations

Object-policy update/delete remain denied pending atomic mutation orchestration within MVP. Read validation after create can fail after insertion; no rollback transaction is claimed. Read/object denial fails the entire operation rather than post-filtering rows.

No composite-key item URLs, route aliases, irregular inflection, offset/cursor pagination, public filtering, custom action HTTP endpoints, or documentation UI. OpenAPI expresses ordinary field constraints and wire types; bigint bounds, native refinements, and arbitrary cross-field/transform rules may be stricter at runtime. Unsupported document schemas fail bootstrap.

Phase 8's host/client/scope-lifetime limitations remain. Schema composers and middleware are trusted application code. Manual routes added after startup and broad middleware can control routing; the runtime does not sandbox application code.

## Follow-Ups

Phase 10 adds Better Auth/session subjects. Before enabling object-based admin writes, add atomic mutation support while preserving scopes and deny precedence. Phase 15 aligns lifecycle/client ownership; Phase 16 proves live SQL/Mongo behavior. Additional query/URL/documentation features are recorded in [post-MVP](../post-mvp.md).

## Completion Notes

Phase 9 is complete. Opt-in public resource CRUD and OpenAPI now compose generated schemas, QuerySets, ABAC, and the request-scoped runtime without resource-specific routes. Required validation and compiled consumers pass. Scope-based item writes return 204; object-policy write restrictions and remaining MVP lifecycle/live-database work are explicitly recorded. Auth/admin remain later phases.
