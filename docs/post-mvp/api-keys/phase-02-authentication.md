# PM3.2 — Request Authentication

## Status

Complete

## Goal

Authenticate API-key requests and create explicit API-key subjects without creating Better Auth browser sessions.

## Scope

- Choose and document the canonical header/transport.
- Extract and verify keys, expiration, revocation, and ownership.
- Build API-key principals and map them through `SubjectFactory`.
- Allow resource APIs to opt into `api-key` authentication alongside `session`.
- Return safe authentication failures and integrate request context.

## Out of Scope

Scope/ABAC conjunction, admin key management, rate-limit enforcement, rotation hardening, and WebSocket/non-HTTP transports.

## Architecture Decisions

Depends on [PM3.1](phase-01-storage.md). API-key authentication is a distinct principal path. Never exchange credentials for Better Auth sessions or claim a human subject. Invalid, expired, and revoked keys fail immediately; errors never echo input. Preserve existing anonymous/session behavior for resources that do not opt into API keys.

## Implementation

- **Transport decision.** `X-API-Key: <key>` (Better Auth's own header), exported as `API_KEY_HEADER`. Keys are read only for public resource API requests: paths under `/api/` except `/api/auth/*` and `/api/openapi.json`. Admin, the admin UI, and the auth endpoints never consult keys.
- **Runtime.** `HonoRuntime` resolves the subject per request: a credential authenticates through `application.auth.apiKeys.authenticate()` and becomes `apiKeySubject(principal)`; otherwise the session path is unchanged. A key wins over a session cookie and there is no session fallback when it fails. An explicit `resolveSubject` option still takes precedence.
- **Verification.** The plugin's `verifyApiKey` hashes the credential and rejects disabled and expired keys; Nestrum additionally rejects keys whose owner no longer exists or is banned, and bounds header input (16–256 printable characters) before any work.
- **Subject.** `{ id: <keyId>, anonymous: false, type: 'api-key', owner: { type: 'user', id }, scopes }`, frozen, with no `role`. It is never a user and never a session; nothing is written to the session table.
- **Resource opt-in.** `defineResource({ api: { auth: ['session', 'api-key'] } })`, validated at definition time (unique, known modes; default `['session']`). The public API rejects a key on a resource that does not accept keys (`API_KEY_NOT_ACCEPTED`, 401) and a session on an `['api-key']`-only resource (`API_KEY_REQUIRED`, 401). Startup fails (`HTTP_API_AUTH_UNCONFIGURED`) if a resource accepts keys but auth is not configured. OpenAPI gains the `ApiKeyAuth` scheme, per-operation `security`, and 401/429 responses for key-enabled resources.
- **Errors.** `ApiKeyError` (401 with `WWW-Authenticate: X-API-Key`; 429 with `Retry-After`): `API_KEY_INVALID`, `API_KEY_EXPIRED`, `API_KEY_REVOKED`, `API_KEY_RATE_LIMITED`, `API_KEY_NOT_ACCEPTED`, `API_KEY_REQUIRED`. Messages are fixed text.

## Public API

Resource `api.auth`; `X-API-Key`; the subject shape above; `ApiKeys.authenticate(request)` (`null` without a credential, throws `ApiKeyError` otherwise); the error codes and statuses above. Precedence on a public resource route: key authentication (runtime) → auth-mode check → scope check (PM3.3) → ABAC → handler.

## Files / Packages Changed

`packages/hono` (`runtime.ts`, `public-api.ts`, `runtime.errors.ts`), `packages/core` (`api-key.ts`, resource definition/registry), `packages/auth` (`authenticate`), tests, [architecture](../../architecture.md), the [initiative index](README.md), and this record.

## Tests

`packages/hono/tests/api-keys.test.ts` (pipeline with a stub verifier): opt-in/opt-out, session-only and key-only resources, invalid and rate-limited failures with no session fallback, keys ignored for admin/auth/OpenAPI, startup validation, OpenAPI output. `packages/auth/tests/api-keys.test.ts`: valid, invalid, malformed, revoked, expired, and owner-less keys, no session created, redacted failures, HTTP unreachability. `packages/admin/tests/api-keys.test.ts`: real keys against an opted-in resource.

## Acceptance Criteria

- [x] Valid key authenticates.
- [x] Invalid/revoked/expired key fails.
- [x] API-key subject is created.
- [x] No Better Auth browser session is created.
- [x] Resource can opt into API-key auth.
- [x] Docs updated.

## Validation

`pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, biome, and `git diff --check` pass.

## Known Limitations

HTTP only (no WebSocket or other transports). Only the canonical header is accepted; query-string and cookie credentials are deliberately unsupported. A custom `resolveSubject` bypasses key handling.

## Follow-Ups

[PM3.3](phase-03-scopes-abac.md) combines scopes with resource/action authorization.

## Completion Notes

Keys authenticate as their own principal; resources that do not opt in behave exactly as before.
