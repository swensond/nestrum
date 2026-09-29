# Authorization query boundary

## Status

Accepted in Phase 7.

## Context

Default deny must cover reads, counts, and mutations. Caller/manager predicates cannot replace authorization scopes. A read grant must not authorize writes. Arbitrary object checks cannot apply to a database count or bulk mutation without fetching rows, and checking rows before a separate mutation introduces a race.

## Decision

Every QuerySet terminal requires an explicit subject/action/environment binding and a registered policy. Policies register before app hooks. Resource guards run before action grants; record conditions belong in action.object. Built-in actions have their corresponding terminal permissions; custom actions declare allowed operations.

Scopes become separate database predicates, preserving the original predicate even when a composed Where schema transforms its parsed value. Object-denied reads fail as a whole rather than post-filtering a collection. Create checks validated proposed data before inserting; collection scopes do not authorize creates.

Count and bulk update/delete reject object callbacks, even with an ID filter. Explicit collection policies authorize these terminals through database scopes. This chooses a visible refusal over bypassing object denial or racing a fetch/check/write sequence. Safe object mutation orchestration remains an MVP follow-up requiring a transaction or equivalent atomic condition.

Standalone capability/object authorization supports arbitrary actions. Collection-scoped actions require QuerySets; a scope's existence does not authorize an arbitrary object. raw remains an explicit bypass.

## Consequences

Phase 6 examples now require authorizedFor. HTTP/admin layers must select the correct action and handle object-policy count/bulk restrictions. Authors express queryable restrictions in scope; object callbacks are not automatically converted into predicates. No field-level checks, ambient request context, transactions, or post-fetch collection filtering are added here.

See [Phase 7](../phases/phase-07-abac.md) and [architecture](../architecture.md).
