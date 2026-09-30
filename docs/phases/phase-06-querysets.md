# Phase 6 — QuerySets and Managers

## Status

Complete

## Goal

Provide immutable Prisma-backed QuerySets as the standard Nestrum data-access layer.

## Scope

- Immutable filter/orderBy/limit chaining, branching, and delayed execution.
- all/first/get/exists/count/create/update/delete terminals.
- Irreplaceable objects and first-class named managers.
- Typed bindings inferred from Prisma collections, runtime resource schemas, and QuerySet subclasses.
- Prisma 8 PostgreSQL/Mongo collection adapters and raw collection access.

## Out of Scope

ABAC (Phase 7), automatic database client creation/disposal, transactions, HTTP/auth/admin, select/include, nested writes, and advanced query operators.

## Architecture Decisions

Prisma 8 rc.13 exposes fluent model collections rather than Prisma 7 findMany/findUnique delegates. Nestrum translates its QuerySet state into those actual collection methods. Core owns portable QuerySets and a narrow execution contract; @nestrum/prisma/querysets owns the supported Prisma integration. This is a Prisma-specific framework, not a promise of interchangeable ORMs. See [ADR 0007](../decisions/0007-querysets-and-prisma-collections.md).

A ResourceModel may carry queryBackend alongside its metadata/generated families. This avoids introducing live clients or a second application bootstrap subsystem. ResourceRegistry creates managers before app hooks. Resources without a backend still expose objects, but authorized evaluation/raw fails explicitly with QUERY_BACKEND_MISSING. Phase 7 now requires an authorization context and policy before evaluation; see its phase record.

## Implementation

QuerySet holds private context/backend/state. Chaining returns a new instance without executing. Repeated filter calls remain separate conjunctive predicates; later calls never overwrite an earlier field constraint. orderBy replaces ordering and accepts field names or a leading minus; scalar metadata/schema validation rejects unknown fields and array ordering. limit replaces the limit and requires a nonnegative safe integer.

Inputs are copied recursively, including Date values. Every evaluation receives another copy, so mutating a caller filter or a backend argument cannot change the saved query. Cyclic inputs fail. Immutable codec values such as Temporal retain their representation. Where/Create/Update validate through the registered resource schemas; returned reads/creates validate through Read. Backend errors propagate without being replaced.

Terminal semantics:

- all returns a validated array. limit(0) returns an empty array without a backend call.
- first returns one matching row or null; exists checks whether first returns a row. Both respect a zero limit.
- get(where?) applies an optional extra filter and fetches at most two rows. Zero matches raises QUERY_NOT_FOUND (404); multiple matches raises QUERY_MULTIPLE_RESULTS. Limited QuerySets cannot call get.
- count applies all filters and ignores ordering/limit. It counts in the database through the configured backend.
- create validates only the supplied create data. Query selection filters/order/limit do not become create defaults or enforce named-manager membership.
- update/delete return affected-row counts and operate on the full matching collection. They ignore ordering and reject limited QuerySets. Unfiltered bulk writes are supported through an explicit empty Prisma where clause; applications control their intended scope.

objects is always created and cannot be replaced on a registered resource. Resource definitions accept managers: { active: (query) => query.filter(...) }. Factory names cannot collide with objects, resource attributes, prototype names, or then. Results must be QuerySets derived from that resource's objects; cross-resource factories fail. Factories run during resource initialization and should only compose queries. Resources expose runtime named properties and a typed managers lookup map. Registered bootstrap resources retain dynamic row shapes because no static model catalog exists.

bindResourceQuerySets(resource, typedBackend, managerFactories) creates a frozen access object with statically named properties and inferred row/create/update/raw types. QuerySet.extend(Subclass) supports domain-specific methods; inherited chains preserve the subclass. Custom constructors must accept the context/backend/state signature. Base QuerySets are frozen; subclasses can initialize their own fields while the base query state remains private and immutable.

Prisma adapters apply separate where calls, native ordering, and native limit before reads. SQL orderBy receives an array of field selector callbacks; Mongo uses a sort map. Reads support both arrays/promises and native async iterables. SQL count uses aggregate(count()); bulk writes use updateAndCount/deleteAndCount rather than fetching records. Mongo rc.13 has no collection count terminal, so its backend requires a database-count callback receiving the compiled Mongo predicate. No post-fetch counting fallback exists.

Supported filter compilation: scalar equality/null, not, in/notIn, lt/lte/gt/gte, AND/OR/NOT, and array equality when the underlying codec supports it. Other operators accepted by the baseline Where family, including text contains and array membership, currently fail with QUERY_OPERATION_UNSUPPORTED. They never silently broaden a query.

## Public API

Core exports QuerySet, QuerySetError, bindResourceQuerySets, QueryBackend, QuerySpec, QueryOrder, QueryWhere, QueryFilter, and ResourceManagers. Existing ResourceModel gains optional queryBackend; RegisteredResource gains objects/managers. QuerySet is generic over Row/Create/Update/Raw.

@nestrum/prisma/querysets exports createPrismaQueryBackend and PrismaQueryBackendOptions. Its collection argument preserves the actual raw type and infers model/read/create/update types from the typed Prisma collection. Use a Prisma client typed against its emitted Contract; a dynamically loaded untyped contract does not provide static model fields.

```ts
import { bindResourceQuerySets, defineResource } from '@nestrum/core';
import { createPrismaQueryBackend } from '@nestrum/prisma/querysets';

const ProjectResource = defineResource({
    model: 'Project',
    managers: {
        active: (query) => query.filter({ status: 'active' }),
        archived: (query) => query.filter({ status: 'archived' })
    }
});

// db is an application-owned, typed Prisma 8 PostgreSQL client.
const backend = createPrismaQueryBackend(db.orm.public.Project, { provider: 'postgresql' });
// Supply { ...generatedSchemas, queryBackend: backend } in resourceModels.
// After startup, bind a typed access object:
const resource = application.resources.get('default.Project');
const Project = bindResourceQuerySets(resource, backend, {
    active: (query) => query.filter({ status: 'active' }),
    archived: (query) => query.filter({ status: 'archived' })
});

await Project.objects.authorizedFor(subject, 'read').filter({ status: 'active' }).orderBy('-createdAt').limit(20).all();
await Project.active.authorizedFor(subject, 'read').filter({ name: 'Example' }).first();
await Project.objects.authorizedFor(subject, 'read').get({ id: projectId });
await Project.objects.authorizedFor(subject, 'read').count();
await Project.objects.authorizedFor(subject, 'create').create(createInput);
await Project.objects.authorizedFor(subject, 'update').filter({ id: projectId }).update(updateInput);
await Project.objects.authorizedFor(subject, 'delete').filter({ id: projectId }).delete();
const nativeCollection = Project.active.raw();
```

The example now assumes Phase 7 policies registered for each operation and an app-owned subject. It uses app-owned db/application/input values and a model with the named fields. The typed helper is optional; application.resources.get(...).objects works directly with dynamic field types. Custom managers can also be accessed through resource.managers.active.

Mongo binding:

```ts
const backend = createPrismaQueryBackend(db.orm.articles, {
    provider: 'mongodb',
    count: async (compiledFilter) => {
        // Execute an application-owned Prisma Mongo count pipeline in the DB.
        // Apply compiledFilter as the match stage and return its count.
        return runCountPipeline(compiledFilter);
    }
});
```

runCountPipeline is an application-supplied database operation, not an exported Nestrum helper. It must apply the provided predicate; client/runtime configuration and count-plan ownership are explicit in this phase.

## raw safety semantics

raw() returns the exact original Prisma collection, regardless of QuerySet/manager filters, ordering, or limits. It bypasses Nestrum input/output validation and manager behavior. Phase 7 authorization is now implemented; raw remains outside automatic Nestrum ABAC scopes/object checks. Calling it is an explicit decision to own those responsibilities. This is direct collection access, not a legacy Prisma 7 delegate or a filtered QuerySet.

## Files / Packages Changed

- Core QuerySet/types/errors/access binding, resource manager configuration and bootstrap attachment.
- New Prisma querysets subpath and PostgreSQL/Mongo adapters.
- Core QuerySet tests and Prisma adapter tests.
- Architecture, phase/MVP/status indexes, README, glossary, ADR 0007, and earlier-phase follow-up notes.

## Tests

Coverage includes lazy immutable branches, conjunctive filtering, order/limit replacement, caller/backend mutation isolation, zero limits, each terminal, unique-get errors, validation/backend failures, limited-write rejection, typed input/output compile assertions, raw identity, named manager invariants, subclass chaining, unbound resources, SQL native call/AST shapes, count-returning writes, and real Mongo ORM execution against an emitted contract with a recording Prisma executor. No running database is required by this bounded phase.

## Acceptance Criteria

- [x] QuerySets are immutable
- [x] Chaining produces correct Prisma operations
- [x] objects always exists and cannot be replaced
- [x] Custom managers work
- [x] Managers remain chainable
- [x] Django-style evaluation methods work
- [x] raw exposes the original Prisma collection
- [x] raw safety semantics are explicitly documented
- [x] Documentation is updated

## Validation

```bash
pnpm check
pnpm install --frozen-lockfile
```

Validated with Node 26.10.0/pnpm 12.6.0: 189 tests in nine files, type checking, all three package builds, frozen lockfile, compiled ESM query exports, and Markdown references pass.

## Known Limitations

Applications own Prisma clients, connection lifecycle, and backend binding. Mongo count requires an explicit database-count callback because the pinned collection API lacks one. Adapter tests use public Prisma AST and a real Mongo ORM collection with a recording executor; live SQL/Mongo end-to-end proof remains Phase 16.

Automatic bootstrap resource row types are dynamic. Typed access requires a collection typed against an emitted Prisma Contract. Full generated Where vocabulary, relation querying, select/include, nested writes, and transactions are not implemented. count deliberately ignores limit; limited get/update/delete are rejected. create does not enforce named-manager filter membership.

## Follow-Ups

Phase 7 integrates ABAC without field-level checks; collection scopes stay in database queries. All QuerySet terminals now require authorizedFor and a registered policy; object-policy count/bulk restrictions are documented there. Later runtime/lifecycle work owns client creation/disposal and can centralize Mongo count execution. Broader query operators remain follow-ups within later MVP integration where needed; no post-MVP system was introduced.

## Completion Notes

Phase 6 is complete. Immutable QuerySets and managers wrap the installed Prisma 8 collection API with explicit backend ownership, runtime validation, typed access, and a documented raw boundary. No ABAC or HTTP system was added.

Current integration evidence (2026-09-30): [Phase 16](phase-16-integration.md) now verifies real Docker PostgreSQL/Mongo contracts, migrations, resources, auth, admin forms/browser flows, and shutdown. Earlier phase-specific fixture results remain historical evidence. Atomic object-policy writes still deny and remain an unmet required MVP follow-up.
