# Phase 11 — Admin Backend Boundary

## Status

Complete

## Goal

Create the private admin API independently of public API exposure.

## Scope

- Serve /__admin/* behind Better Auth session and admin.access ABAC.
- Enforce same-origin by default; allow explicit admin.allowedOrigins.
- Implement separate admin.register(resource, configuration).
- Expose resource/field metadata, list configuration, generic CRUD, known custom actions, and authorized resource discovery.
- Reuse QuerySets and ABAC, including for api: false resources.

## Out of Scope

Svelte UI, public-route coupling, polished design, and custom action handler implementation beyond the metadata seam.

## Architecture Decisions

Follow the locked contracts in [architecture](../architecture.md). Registration and private routing remain independent of public API exposure.

The portable core holds AdminDefinition/AdminApi contracts; @nestrum/admin owns registration, metadata, origin checks, and its Fetch router. Hono mounts the initialized private API and supplies trusted subject/environment attributes plus the existing error observer. Admin initializes after configure hooks (allowing app-owned registration), before ready hooks. Registration closes at initialization. Auth remains initialized before configure.

## Implementation

@nestrum/admin exports defineAdmin. ApplicationConfig accepts admin alongside required auth. The Hono runtime reserves /__admin and /__admin/* and rejects preexisting overlapping routes, including application catch-all routes. No public exposure flag is required. Resources still must be ordinary registered application resources with compiled metadata, schemas, and backend bindings.

Every data/metadata request requires a live Better Auth session and a default-deny policy for resource `admin.access`, action `access`. Resource discovery and direct metadata lookup probe resource grants without accessing the backend; CRUD always authorizes again through QuerySets. Capability and action metadata are advisory: object/input decisions and valid scopes remain authoritative during operations.

Same-origin Origin/Referer values are accepted; foreign, opaque (`null`), and malformed origins are denied. Originless non-browser clients are allowed, while originless requests marked cross-site are denied. Explicit allowedOrigins are validated and support credentialed CORS, including readable validation errors. Allowed-origin OPTIONS preflight carries no metadata/data and does not require a session; actual requests do.

CRUD shares JSON validation, scalar codecs, and primary-key parsing with public routes through separate Hono request/transport helpers. Lists accept limit (default 20, maximum 100) and comma-separated orderBy, returning `{ rows }`. Item routes require a single nonnullable scalar primary key. PATCH/DELETE return empty 204 responses. Zero affected records return 404; an invalid affected count fails. Nested relation writes and primary-key updates in composed schemas fail startup.

## Public API

```ts
import { defineAdmin } from '@nestrum/admin';
import { allow, defineApplication, definePolicy, defineResource, deny } from '@nestrum/core';

const Project = defineResource({ model: 'Project', api: false });
const admin = defineAdmin({ allowedOrigins: ['https://admin.example.com'] });
admin.register(Project, {
    listDisplay: ['id', 'name'],
    fields: { name: { label: 'Project name' }, createdAt: { readOnly: true } },
    actions: { archive: { label: 'Archive' } }
});
const adminAccess = definePolicy({
    resource: 'admin.access',
    actions: { access: { authorize: ({ subject }) => subject.staff === true ? allow() : deny('NOT_STAFF') } }
});
// Compose with configured auth, databases, apps, resourceModels, and Project policies:
const application = defineApplication({
    auth, admin, databases, apps, resources: [Project], resourceModels,
    policies: [adminAccess, projectPolicy]
});
```

`admin.allowedOrigins` exposes the normalized frozen list. `defineAdmin({ temporal })` supplies the same Temporal adapters supported by public transport. Field labels and hidden are presentation metadata; hidden does not remove data from stable read schemas or grant confidentiality. Explicit readOnly rejects client writes. Composed Create/Update/Read schemas still own validation and response projection. Hidden fields cannot appear in listDisplay. Duplicate identities/slugs, unknown fields, and custom names conflicting with built-in operations fail registration/startup.

| Endpoint | Behavior |
| --- | --- |
| GET /__admin/resources | Authorized resource metadata and capabilities |
| GET /__admin/resources/:slug | Same visibility check for one resource; unavailable returns 404 |
| GET /__admin/:slug | Bounded scoped list |
| POST /__admin/:slug | Validated authorized create; 201 |
| GET /__admin/:slug/:id | Scoped retrieve |
| PATCH /__admin/:slug/:id | Scoped update; 204 |
| DELETE /__admin/:slug/:id | Scoped delete; 204 |
| POST /__admin/:slug/:id/actions/:action | Known-action authorization seam; authorized calls return 501 until handlers ship |

Default database slugs use plural kebab-case model names, e.g. projects. Named database slugs use database--model, e.g. documents--articles. The resources slug is reserved for metadata routes. Custom action metadata includes only configured names with policy grants; item execution additionally requires read access and the action's object decision. No action handler runs in this phase.

## Files / Packages Changed

- @nestrum/admin: definition, registry/resolution, metadata, access/origin checks, Fetch router, and backend integration tests.
- @nestrum/core: portable admin contracts/errors and application bootstrap; shared resource slug helper.
- @nestrum/hono: private API mounting, reserved-route checks, shared request/transport helpers, and error observer handoff.
- Workspace lockfile/Vitest project; README, architecture, and phase records.

## Tests

27 admin tests cover session/access-denial matrix, forged/expired sessions, real Better Auth signup/login/logout/SubjectFactory, ordinary-user denial, runtime subject overrides requiring a live session, same-origin/allowed-origin/opaque-origin behavior, credentialed preflight and error responses, metadata visibility, readonly configuration, custom action/object grants, registration/startup conflicts, named databases, malformed requests, typed scalar transport, and scoped CRUD for api:false resources.

## Acceptance Criteria

- [x] Unauthorized users cannot access admin API
- [x] admin.access is default-deny
- [x] Same-origin is enforced by default
- [x] Metadata discovery works
- [x] Admin CRUD works without public API
- [x] Documentation is updated

## Validation

```bash
pnpm test
pnpm typecheck
pnpm check
pnpm build
```

Validated on 2026-09-29:

- `pnpm check`: 297 tests across 14 files, strict typecheck, and all six package builds passed.
- `pnpm lint` and `git diff --check`: passed.
- Compiled ESM import and TypeScript consumer checks: passed for defineAdmin and its exported contracts/metadata.
- Reviewed the starting working tree against standards and scope; fixed incomplete exports/context types, field-name validation, metadata authorization, opaque-origin handling, and invalid 204 response bodies. Shared primary-key parsing removed duplicated validation. Existing public list-query limits were preserved.

## Known Limitations

Custom action handlers and UI are deferred to their planned phases. Action metadata does not promise an object/input grant. Lists currently have no total/count, cursor, offset, or arbitrary filter interface. Regular pluralization and a single scalar key match public API constraints. readOnly/hidden are admin configuration, not field-level ABAC.

Origin checks use the Fetch request URL; deployment proxies must supply the correct externally visible origin. Cross-site cookie delivery remains subject to the configured cookie/browser rules. Application-supplied trusted subject resolvers remain supported, but never replace the required session check. Registration definitions initialize for one application only.

Tests use in-memory auth collections and QueryBackend fixtures with assertions on database scope specifications. Live PostgreSQL/MongoDB proof remains Phase 16. Existing atomic object-policy mutation limitations apply; scope-based writes work, while object-policy update/delete continue to deny. Lifecycle client ownership and final bootstrap hardening remain Phase 15.

## Follow-Ups

Phase 12 can consume resource metadata for navigation, Phase 13 can use CRUD, and Phase 14 can add custom action handlers/components. Phase 15 hardens the final lifecycle; Phase 16 proves live database behavior. Advanced admin pagination/filtering remains deferred with the existing advanced-search scope in [post-MVP](../post-mvp.md).

## Completion Notes

Phase 11 is complete. Private session/ABAC/origin boundaries, independent registration and discovery, generic CRUD without public exposure, and the known-action metadata seam are implemented and validated. UI and action-handler implementation remain scoped to later phases.
