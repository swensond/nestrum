# 0015 — First-class API keys on Better Auth's API-key plugin

## Status

Accepted — completes [Post-MVP Plan 03](../post-mvp/api-keys/README.md).

## Context

Resource APIs needed machine authentication with one-time-reveal hashed secrets, ownership, scopes, expiry, revocation, rate limits, explicit ABAC subjects, and protected admin management, without every application writing key storage, hashing, or middleware. Better Auth already ships an official API-key plugin, so Nestrum must integrate it rather than implement key cryptography, storage, verification, or rate limiting itself.

## Decision

- **The plugin does the work.** `@better-auth/api-key` generates keys (`nes_live_` prefix by default, 64 random letters), hashes them (SHA-256, appropriate for high-entropy random secrets; plaintext is never stored), verifies them, enforces expiry and per-key rate limits with atomic guarded updates, tracks last use, and stores per-key permissions. Nestrum's code is a thin service (`ApiKeys` in `@nestrum/auth`) that calls the plugin's server-side endpoints, plus the HTTP, ABAC, and admin integration around it.
- **Only server-side calls; no HTTP surface.** The plugin's `/api-key/*` endpoints are not forwarded by `/api/auth`, `enableSessionForAPIKeys` is off, and the plugin's session mock never runs, so a key cannot become a Better Auth session. The prebaked contract gains the `ApiKey` model (plugin table `apikey` renamed `ApiKey`), and `ApiKey` joins the protected auth models.
- **Transport.** `X-API-Key: <key>` (Better Auth's own header). Keys are read only for public resource API requests (`/api/*` excluding `/api/auth/*` and the OpenAPI document), never for admin, the admin UI, or auth endpoints. A key wins over any session cookie on a request, and a bad key fails immediately instead of falling back to the session.
- **Explicit subject.** A verified key becomes `{ id: <keyId>, anonymous: false, type: 'api-key', owner: { type: 'user', id }, scopes: [...] }` with no `role`. Policies distinguish keys by `subject.type`; the owner is data, not identity.
- **Resource opt-in.** `defineResource({ api: { auth: ['session', 'api-key'], scopes: {...}, list: true, ... } })`. The default is `['session']`. A key sent to a resource that does not accept keys is a 401, and an `['api-key']`-only resource rejects sessions. The app refuses to start if a resource accepts keys and authentication is not configured.
- **Scopes plus ABAC.** Scopes are `resource:action` strings stored as plugin permissions (`projects:read` ↔ `{ projects: ['read'] }`). The default requirement is `<resource-slug>:read` for list/retrieve and `:write` for mutations; `api.scopes` overrides per operation; `projects:*` grants every action on that resource prefix and never widens further. The check happens before resource ABAC, and both must allow. Malformed scopes fail closed.
- **Admin management.** `/__admin/api-keys` (list, create, revoke, rotate, capabilities) and the `/admin/api-keys` Svelte page sit behind the complete admin boundary including admin 2FA, then require the `api-key` ABAC actions `read`, `create`, `revoke`, `rotate` (a missing policy action denies). `roleBasedAdminPolicies()` grants them to `admin` only. The secret appears only in the create and rotate responses (`Cache-Control: no-store`).
- **Revocation and rotation.** Revoking sets the plugin's `enabled: false` and records `revokedAt` in key metadata; the row is kept. Rotation creates a replacement with the same name, owner, scopes, lifetime, rate limit, and metadata, reveals it once, then revokes the predecessor (and revokes the replacement if that step fails).
- **Errors and logs.** Failures are fixed messages (`API_KEY_INVALID`, `API_KEY_EXPIRED`, `API_KEY_REVOKED`, `API_KEY_RATE_LIMITED` with `Retry-After`, `API_KEY_NOT_ACCEPTED`, `API_KEY_REQUIRED`, `API_KEY_SCOPE_DENIED`); a supplied credential is never echoed, and a test captures every log line emitted during verification.

## Consequences

- Existing applications must migrate the new `ApiKey` table (one additive migration).
- **Owner types.** Only `user` owners are supported. Organization-owned keys need Better Auth's organization plugin (membership tables and roles), which Nestrum does not include, so `organization` owners remain future work; the subject shape already carries `owner.type`.
- **Expiry deletes.** The plugin deletes an expired key when it is next verified or during its periodic cleanup, so expired keys eventually disappear rather than carrying `revokedAt`. Revoked keys are kept.
- **No transactions.** Storage declares sequential operations, so rotation is create → revoke with compensation. A crash between the two leaves both keys valid, never neither. Two simultaneous rotations of one key can each create a replacement; revoke the extra.
- **Rate limits** are per key, stored on the key row, and consumed atomically by the plugin (verified under concurrency against real PostgreSQL). A shared external provider would use the plugin's secondary-storage mode, which Nestrum does not expose yet; keys would then also need the database for admin listing.
- The plugin logs each failed verification at error level (code and message only, no credential); change Better Auth's logger level to quiet it.
- Key verification adds one query for the key row, one for its owner, and the atomic counter updates. `lastUsedAt` is the plugin's `lastRequest`.
- The admin list reads the plugin's table through Better Auth's adapter because the plugin's own list endpoint is scoped to a signed-in owner. No plugin logic is reimplemented.

## References

- [Better Auth API-key plugin](https://www.better-auth.com/docs/plugins/api-key)
- [0011 — Framework-owned Better Auth boundary](0011-better-auth-boundary.md)
- [0014 — Roles and staff management](0014-roles-and-staff-management.md)
