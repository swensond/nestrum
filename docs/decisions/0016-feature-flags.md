# 0016 — Typed boolean feature flags

## Status

Accepted — completes [Post-MVP Plan 05](../post-mvp/feature-flags/README.md).

## Context

Applications need to switch capabilities on and off per environment, organization, subject or rollout percentage without redeploying, and the hosted consumer UI needs to know which capabilities are on. A flag answers "is this capability enabled?"; ABAC answers "may this subject do it?". The two must never blur.

## Decision

- **Where it lives.** Registry, evaluator, targeting, hash, memory store, manager and testing helper are in `@nestrum/core` (`packages/core/src/features`). Prisma persistence, the `FeatureOverride` contract, `defineFeatures` and development overrides are in the new `@nestrum/features`. Admin routes are in `@nestrum/admin`, the admin page in `@nestrum/admin-ui`, the request/InferDI/client-value integration in `@nestrum/hono`, and the browser helper in `@nestrum/web/client`.
- **Declaration.** `defineFeatureFlags({ name: { default, description?, exposeToClient? } })`. Names are camelCase identifiers of at most 64 characters (`registry` is reserved); duplicates across merged sets, non-boolean defaults and unknown names are rejected. The result is frozen, and each flag is a typed handle (`features.newDashboard.enabled(context?)`) that evaluates through the application it is registered with (`defineApplication({ features: defineFeatures({ flags }) })`). Before that application starts, and after it shuts down, handles throw `FEATURES_NOT_READY`.
- **Precedence (first match wins).** in-process override, subject, organization, percentage rollout, environment, global, declared default. This is the planned order with one refinement: a `global` override sits between environment and the default, so "on everywhere" is expressible without naming every environment. Missing context skips only the layers that need it.
- **Context.** `{ subject?, stableId?, organizationId?, environment?, attributes? }`, trusted inputs only. The stable key is `stableId ?? subject.id`. `attributes` is carried for application code and never read by targeting. From a request, the organization is `subject.organizationId ?? environment.organizationId`, and an anonymous rollout identifier is `environment.featureKey`, both application-resolved values (`resolveSubject`/`resolveEnvironment`), never headers, cookies or query strings. Nestrum creates no tracking identifier: an anonymous actor without `featureKey` sees only non-rollout layers.
- **Rollout.** `bucket = murmur3("v1\0<flag>\0<stableKey>") % 10000`; a subject is inside a `percentage` rule when `bucket < round(percentage × 100)`. Percentages are 0–100 with at most two decimals, and the algorithm is version-tagged (`ROLLOUT_HASH_VERSION`), so buckets move only when the configured percentage changes. There is no randomness and no clock.
- **Storage.** `FeatureOverride(id, flag, scope, target, enabled, percentage, updatedBy, createdAt, updatedAt)` with a unique `(flag, scope, target)` key, contributed as a Nestrum-owned Prisma fragment to the database named by `features.database` (PostgreSQL and MongoDB contracts; the model joins the protected models, like the auth ones). Without `database`/`prisma`, overrides live in memory. Upserts read then update-or-create, and a lost create race retries as an update.
- **Failure policy.** A store error during evaluation returns the declared default with reason `{ source: 'default', degraded: true }` and calls `onError`. Writes fail loudly.
- **Caching.** Off by default (`cacheTtlMs: 0`: every evaluation reads storage, so changes apply immediately). With a TTL, all rules are cached in-process; writes through the manager invalidate synchronously, `evaluator.invalidate()` covers external writers, and other processes see changes within the TTL.
- **Runtime.** `application.features` (evaluator, manager, registry, `forRequest`) exists after startup. Request scopes get a scoped InferDI service `features` (`enabled`, `evaluate`, `exposed`) bound to the trusted subject and environment, also available as `context.var.nestrum.features`; without configured features it throws `FEATURES_NOT_CONFIGURED`. Resource-level declarative gating stays out of scope.
- **Admin.** `/__admin/features` (list), `PUT /__admin/features/:flag/rules`, `DELETE …/rules?scope=&target=`, `POST …/explain`, `GET …/capabilities`, and the `/admin/features` page. All sit behind the complete admin boundary (same origin, session, `admin.access`, 2FA), then need the `features` ABAC actions `read` (staff and admin) or `manage` (admin only) from `roleBasedAdminPolicies()`; a missing policy denies. Explanations take only `subjectId`, `organizationId` and `environment`, and return the winning rule's source and target, never attributes or other rules.
- **Audit seam.** `onChange` listeners receive `{ type, flag, scope, target, enabled, percentage, actor, at }` after every persisted set/remove; listener failures are reported through `onError` and never undo the change. Full audit history is a separate product.
- **Client exposure.** `GET /__nestrum/features` (reserved namespace, so the consumer UI can never shadow it) returns `{ features: { name: boolean } }` for `exposeToClient` flags only, evaluated for the request's subject, with `Cache-Control: private, no-store` and `Vary: Cookie`. `createFeatureClient()` from `@nestrum/web/client` loads it, exposes `enabled(name)` and a store-compatible `state`, and fails closed (every flag off). Values are informational; server routes still authorize with ABAC.
- **Testing and development.** `withFeatureFlags(flags, { name: true }, callback)` binds the flags to a fresh in-memory evaluator for the callback and restores the previous binding, even when it throws (process-wide for the callback, so run such tests serially). `evaluator.withOverrides()` derives an isolated evaluator. `nestrum dev --feature name=true|false` (repeatable, dev only) passes overrides to `defineFeatures` through `NESTRUM_DEV_FEATURES`, honored only when `NESTRUM_ENV` is `development`; they never touch storage and are listed in the dev banner.

## Consequences

- Existing applications adopting features migrate one additive `FeatureOverride` table on the selected database.
- Overrides are keyed by flag name; removing a flag from source leaves inert rows that the admin list no longer shows. The admin cannot create overrides for undeclared flags.
- The unique key prevents duplicate rows but the read-then-write upsert is not a single atomic statement; concurrent writers converge on one row, and the last writer wins.
- Multivariate values, attribute-based targeting, declarative resource gating, scheduled changes and audit history are future work.
- MongoDB storage is verified for contract emission and through the store's unit tests; its live run is part of the Docker + MongoDB integration suite, which the project owner ran and passes.

## References

- [0015 — First-class API keys](0015-api-keys.md): the admin route, ABAC action and protected-model pattern reused here.
- [Post-MVP Plan 05](../post-mvp/feature-flags/README.md)
