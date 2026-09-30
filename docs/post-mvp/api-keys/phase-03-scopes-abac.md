# PM3.3 — Scopes and ABAC Integration

## Status

Complete

## Goal

Enforce API-key scopes and existing resource/action ABAC together.

## Scope

- Define scope naming/normalization and required-scope mapping for resource operations.
- Add API-key scope attributes to explicit subjects.
- Deny when scope is insufficient even if ABAC allows.
- Deny when ABAC disallows even if scope allows.
- Preserve human-session authorization and resource operation defaults.

## Out of Scope

Admin UI/API, rate-limit providers, rotation hardening, and replacing ABAC with scopes.

## Architecture Decisions

Depends on [PM3.2](phase-02-authentication.md). Effective authorization is the intersection of scope permission and ABAC permission. Scope checks must be explicit, fail closed, and occur before the handler while retaining normal QuerySet/resource policy checks. API-key subjects may be distinguished by type/attributes in policies.

## Implementation

- **Vocabulary.** Scopes are `resource:action`, lowercase (`projects:read`, `audit-logs:export`); `resource:*` grants every action on that prefix and nothing wider. There is no global wildcard. `parseApiKeyScopes` rejects malformed input on creation rather than repairing it; `scopesSatisfy` ignores malformed grants and requirements (fail closed).
- **Storage.** Scopes are the plugin's per-key `permissions` (`projects:read` ↔ `{ projects: ['read'] }`), written only server-side so a client cannot choose its scopes.
- **Mapping.** `requiredApiScope(resource, operation)`: `list` and `retrieve` need `<slug>:read`, `create`, `update`, and `delete` need `<slug>:write`, where the slug is the public-API slug of the model (`BlogPost` → `blog-posts`). `api.scopes` overrides any operation with its own `resource:action`.
- **Enforcement.** In the public route handler, after the auth-mode gate and before any QuerySet work: an API-key subject without the required scope gets `API_KEY_SCOPE_DENIED` (403) naming the missing scope. The request then goes through the normal `authorizedFor(subject, action, environment)` path, so collection scopes, object decisions, and action policies all still apply; a denial from either layer denies the request. Human sessions are untouched.
- **Policies.** Keys are distinguishable by `subject.type === 'api-key'`, `subject.owner`, and `subject.scopes`; the example policy scopes records to `subject.owner.id` for keys and denies deletion to keys even when the scope allows it.
- **Validation.** Invalid `api.auth` and `api.scopes` fail at `defineResource`, before startup.

## Public API

`resource.api.scopes`, `requiredApiScope`, `scopesSatisfy`, `parseApiKeyScopes`, `isApiKeyScope`, `apiKeySubject`, and `ApiKeyError` (`API_KEY_SCOPE_DENIED`, 403) from `@nestrum/core`. Custom scopes need no registration: any `resource:action` string can be required with `api.scopes` and granted at creation.

## Files / Packages Changed

`packages/core` (`api-key.ts`, `resource.ts`), `packages/hono` (`public-api.ts`), the example Project resource and policy, tests, [architecture](../../architecture.md), the [initiative index](README.md), and this record.

## Tests

`packages/core/tests/api-keys.test.ts` (vocabulary, wildcard narrowing, fail-closed matching, default and overridden mappings) and `packages/hono/tests/api-keys.test.ts` (read/write requirements per operation, scope denial with ABAC allowing, ABAC denial with the scope allowing, overrides, malformed configuration). `packages/admin/tests/api-keys.test.ts` repeats scope and owner-policy checks with real keys.

## Acceptance Criteria

- [x] Key scope can deny.
- [x] ABAC can deny.
- [x] Both must allow.
- [x] Resource can opt into API-key auth and scope requirements.
- [x] Docs updated.

## Validation

`pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, biome, and `git diff --check` pass.

## Known Limitations

Scope vocabulary is string-based and is not registered or checked against resources at startup beyond its format (an unused or misspelled scope simply grants nothing). Field-level scopes are out of scope, as field-level ABAC is.

## Follow-Ups

[PM3.4](phase-04-admin.md) adds secure admin management protected by PM2 2FA.

## Completion Notes

Effective authorization is the intersection of scope and ABAC, enforced before any data access.
