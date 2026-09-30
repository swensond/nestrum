# Phase 7 — ABAC Engine

## Status

Complete

## Goal

Implement default-deny resource/action authorization with database collection scopes.

## Scope

- Subject/action/resource/environment decisions and arbitrary action names.
- Resource guards, action grants, object decisions, and collection scopes.
- Scalar provider-neutral filter AST and validation before execution.
- Immutable authorizedFor bindings on QuerySets, managers, and subclasses.
- Application/app policy registration before hooks.
- SQL/Mongo database scopes through the existing Prisma adapters.

## Out of Scope

Field-level ABAC, auth/session subjects, ambient request scopes, HTTP/admin, transactions, nested/relation policies, and automatic Prisma client ownership.

## Architecture Decisions

See [ADR 0008](../decisions/0008-authorization-query-boundary.md). Every QuerySet terminal requires an explicit authorization context. Missing policies/actions and empty grants deny; raw bypasses authorization.

Count and bulk writes cannot safely apply arbitrary object callbacks and reject those policies before DB access. Use collection policies for those terminals. Transactional object mutation orchestration remains an MVP follow-up.

## Implementation

AuthorizationEngine copies/freezes definitions. Application policies register first, then app policies in dependency/declaration order; duplicate identities fail. Policies can target models such as default.Project or standalone capabilities such as admin. Bootstrap does not require every resource to have a policy, but querying an unprotected resource denies. Application/hooks/resources expose the same authorization engine.

Policy authorize is a resource-level guard before action grants. Its resource is absent: it decides about identity, subject/action/environment, and optional operation/input. Record conditions belong in action.object. Resource denial always wins. Action authorize requires an explicit allow; invalid decisions deny and callback failures propagate without DB execution. An action requires at least one authorize/scope/object callback to grant anything.

QuerySet.authorizedFor(subject, action, environment?) snapshots record/array/date data and returns a branch. Rebinding does not change its parent; subclasses preserve bindings. Managers have no implicit actor. Every terminal, including limit(0), requires a binding and engine. The read action permits read/count operations; create/update/delete each permit the corresponding terminal. Custom actions declare operations, preventing a read grant from implicitly becoming a write grant.

Each scope compiles to a separate conjunctive Where predicate beside caller/manager predicates. Scalar metadata names and the resource Where schema validate it before execution. Schema transforms cannot strip or substitute policy predicates: the original compiled predicate is retained after validation. Existing Prisma adapters lower it into SQL AST/Mongo match expressions. Mongo count receives the scoped native predicate through the application-owned database-count callback.

Read validates rows through Read and checks each object. Any denial fails the entire operation; results are never silently post-filtered. first/get/exists inherit these checks. Count/update/delete reject action.object before DB access, even for ID-filtered queries. Collection policies scope these terminals without fetching mutation records.

Create validates Create and checks grants/proposed objects before inserting. Scope-bearing create actions deny because a collection predicate cannot authorize a new record. authorize can inspect input and object can inspect resource. Checks see supplied validated data, not generated IDs/defaults. Selection filters do not constrain create. Created rows still validate through Read.

Standalone authorization returns allow/deny for capability/object actions. Missing objects deny when an object callback is required. Collection scopes require QuerySets; standalone authorization denies SCOPE_REQUIRES_QUERY even with a supplied object. A scoped QuerySet read with an explicitly permitted read operation can check an object instead.

## Public API

Core exports AuthorizationEngine, definePolicy, allow, deny, AuthorizationError, PolicyError, policy/context/decision types, and QueryState. AppDefinition/ApplicationConfig gain policies. Application/AppContext/RegisteredResource expose authorization. ResourceRegistry accepts an optional third engine argument, defaulting to an empty engine. QueryState carries the binding; backend QuerySpec carries only query predicates/order/limit.

Filter helpers: eq, neq, inFilter, notIn, isNull, and, or, not. inFilter is also exported as in; import it as `in as inValues` because in is a JavaScript keyword. Nodes and lists are frozen; scalar/date inputs are copied. compilePolicyScope validates scalar names and acyclic nodes. Empty logical groups, malformed nodes, undefined/non-finite values, and unknown fields fail closed. Empty membership lists remain explicit predicates. Supported values are string/number/bigint/boolean/null/Date; relation/array/Temporal scope values are not supported yet.

```ts
import { allow, defineApp, definePolicy, deny, eq } from '@nestrum/core';

const ProjectPolicy = definePolicy({
    resource: 'default.Project',
    authorize: ({ subject }) => typeof subject.id === 'string' ? allow() : deny('ANONYMOUS'),
    actions: {
        read: { scope: ({ subject }) => eq('ownerId', subject.id as string) },
        update: { scope: ({ subject }) => eq('ownerId', subject.id as string) },
        delete: { scope: ({ subject }) => eq('ownerId', subject.id as string) },
        create: {
            object: ({ subject, resource }) => resource?.ownerId === subject.id ? allow() : deny('NOT_OWNER')
        },
        archive: {
            operations: ['update'],
            scope: ({ subject }) => eq('ownerId', subject.id as string)
        },
        approve: {
            object: ({ subject, resource }) => resource?.ownerId === subject.id ? allow() : deny('NOT_OWNER')
        }
    }
});
const projects = defineApp({ name: 'projects', resources: [ProjectResource], policies: [ProjectPolicy] });
// Register projects with the application and supply the model/backend as in Phase 6.
const Project = application.resources.get('default.Project');
const subject = { id: 'alice' };
await Project.objects.authorizedFor(subject, 'read').filter({ status: 'active' }).all();
await Project.objects.authorizedFor(subject, 'archive').filter({ id: projectId }).update({ status: 'archived' });
const decision = await application.authorization.authorize({
    identity: 'default.Project', subject, action: 'approve', environment: {}, resource: project
});
if (!decision.allowed) {
    throw new Error(decision.reason);
}
```

The example assumes application-owned ProjectResource/application/project values. Subject/environment are attribute records; callers own opaque custom objects nested within them. Binding does not authenticate a subject: trusted services/runtime code must supply it. Better Auth subject mapping remains Phase 10.

A read policy with both scope and object works for list/get/first/exists but count denies. If counts are needed, define a separate count-capable action with an explicit collection policy; do not grant broader access merely to avoid the restriction.

PreparedAuthorization from engine.prepare is the integration seam used by QuerySet. Direct callers own applying/validating its scope and invoking object checks; QuerySet is the supported automatic data-access authorization boundary. raw returns the exact original unfiltered Prisma collection and bypasses scopes, object checks, validation, and manager filters.

## Files / Packages Changed

- Core authorization definitions/engine/errors and scalar AST/compiler.
- QuerySet binding/state/terminal enforcement and scope validation.
- Application/app/registry bootstrap, resource types, and exports.
- Core authorization tests and Phase 6 fixtures with explicit policies.
- Prisma adapter tests using native SQL AST and real Mongo collections.
- Architecture/status/MVP indexes, README, glossary, Phase 6 examples, and ADR 0008.

## Tests

Coverage includes default deny, inherited action names, zero limits, denial precedence, arbitrary actions, invalid grants, object decisions, immutable branches, DB predicates, action/operation mismatch, scoped counts/writes, object-policy terminal rejection, create checks before effects, raw bypass, policy failures, every AST helper, malformed/cyclic scopes, missing subject attributes, schema transform isolation, duplicate/frozen policies, and pre-hook registration.

Integration tests prove caller/scoped predicates enter native SQL where expressions and real Mongo match pipelines using emitted contracts and a recording executor. Mongo count receives the scoped predicate. Live SQL/Mongo testing remains Phase 16.

## Acceptance Criteria

- [x] Missing policy denies
- [x] Missing action denies
- [x] Arbitrary actions work
- [x] Object authorization works
- [x] Collection scope compiles to Prisma
- [x] Filtering occurs in the database query, not post-fetch
- [x] Policy tests are readable
- [x] Documentation matches actual implementation

## Validation

```bash
pnpm test
pnpm typecheck
pnpm check
pnpm build
```

pnpm check passed: 209 tests across ten files, root type checking, and all three package builds. Compiled ESM smoke checks verified authorization exports, default deny, database scopes, action/operation binding, and raw access. Markdown references and whitespace checks passed. No dependencies or lockfile entries changed.

## Known Limitations

Count/bulk mutations reject per-object policies; ID filters do not bypass this. Atomic object mutation orchestration remains an MVP follow-up before exposing affected CRUD paths. Create checks see proposed input rather than generated defaults. Resource guards do not inspect records; use action.object for record conditions.

Standalone decisions reject collection scopes. Scalar AST values omit relation/array/Temporal expressions. SQL/Mongo retain provider null/missing-field semantics. Mongo count depends on its callback faithfully applying the supplied predicate. Subject/session mapping, client lifecycle, and live DB proof remain later phases. Automatic authorization does not protect raw or direct backend calls.

## Follow-Ups

Phase 8 supplies request scopes and trusted subject/environment plumbing. Public/admin layers must select correct actions and handle count/bulk object-policy restrictions. Add atomic object update/delete orchestration within MVP before enabling such paths; retain denial until it exists. Broader value representations can follow when representative models need them. No post-MVP subsystem was introduced.

## Completion Notes

Phase 7 is complete. Default-deny ABAC, policy registration, scoped QuerySets, object decisions, and arbitrary actions are implemented and validated. No HTTP/auth/admin systems were introduced. Object-policy count/bulk restrictions and atomic mutation follow-ups remain explicit.

Current integration evidence (2026-09-30): [Phase 16](phase-16-integration.md) now verifies real Docker PostgreSQL/Mongo contracts, migrations, resources, auth, admin forms/browser flows, and shutdown. Earlier phase-specific fixture results remain historical evidence. Atomic object-policy writes still deny and remain an unmet required MVP follow-up.
