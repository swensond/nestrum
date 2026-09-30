# PM3.5 — API-Key Hardening

## Status

Complete

## Goal

Complete last-use tracking, rate limiting, rotation, secret redaction, and real resource API integration.

## Scope

- Track `lastUsedAt` safely and define update/failure semantics.
- Provide a framework rate-limit path with a simple initial provider and an extension seam for Redis/external backends.
- Test rotation, expiry, revocation, one-time reveal, and any documented overlap policy.
- Verify logs/errors/diagnostics redact credentials and sensitive metadata.
- Run full API-key resource, admin, and security integration coverage.
- Update architecture, roadmap, and phase records to actual shipped behavior.

## Out of Scope

Service identities, WebAuthn, arbitrary external rate-limit implementations, browser-session exchange, and unrelated API redesign.

## Architecture Decisions

Depends on PM3.1–PM3.4. Rate limiting is framework metadata and policy, not a reason to weaken authentication or ABAC. Failed credentials must not update successful-use metadata. Rotation/revocation must be atomic from the caller's perspective as far as the storage contract permits. Document concurrency and clock assumptions.

## Implementation

- **Last use.** The plugin records `lastRequest` on each successful verification; it is exposed as `lastUsedAt`. Failed checks (unknown, malformed, expired, revoked, rate-limited, owner missing) write nothing, verified by test. Because the update happens as part of the atomic verification, a failure to record it fails the request instead of being silently skipped.
- **Rate limits.** Per key, default 1000 requests per 60 seconds (`apiKeys.rateLimit`), overridable at creation (`enabled`, `requests`, `windowSeconds`). The plugin consumes the counter with guarded atomic updates on the key row, so concurrent bursts cannot exceed the limit (verified with a 12-request race against real PostgreSQL: exactly 5 of 5 allowed). An exceeded limit is `API_KEY_RATE_LIMITED` (429) with `Retry-After`. The extension seam for shared/external providers is the plugin's secondary-storage mode, not exposed yet; nothing in the public contract depends on the database counter.
- **Rotation.** Create → reveal → revoke, compensating on failure; tested, including the compensation path.
- **Redaction.** Errors are fixed strings; causes carry only plugin codes; a test captures every console line emitted while verifying valid, unknown, revoked, and rate-limited keys and asserts no credential appears. Summaries and logs use `start` (`nes_live_abcd…`) for recognition.
- **Integration.** `packages/admin/tests/api-keys.test.ts` drives the real stack: admin 2FA-protected create/list/revoke/rotate, then an opted-in resource API using real keys (scopes, owner policy, revocation, rotation, rate limit, keys refused by admin and session endpoints). `apps/example/tooling/api-keys-postgres.mjs` (`pnpm --filter @nestrum/example verify:api-keys`) repeats storage, expiry, revocation, rotation, and the concurrent rate-limit boundary on real PostgreSQL. `apps/example/tooling/integration.mjs` gained an API-key section (Docker + MongoDB); the project owner ran it and it passes.
- **Assumptions.** The server clock decides expiry and rate-limit windows. Storage has no transactions, so two simultaneous rotations of one key can both succeed; the stray replacement is an ordinary key that can be revoked.

## Public API

Final: key format `nes_live_` (configurable) plus 64 random letters; header `X-API-Key`; resource modes `session` and `api-key`; scopes `resource:action` and `resource:*`; TTL `apiKeys.defaultTtlDays`/`maxTtlDays` and per-key `expiresInDays`; rate limit `apiKeys.rateLimit` and per-key overrides; rotation as above; statuses 401 (invalid/expired/revoked/not accepted/required), 403 (scope, ABAC), 429 (rate limited). See [decision 0015](../../decisions/0015-api-keys.md).

## Files / Packages Changed

`apps/example` (Project resource opt-in, owner-aware policy, integration runner section, `verify:api-keys`), tests across auth/hono/admin/admin-ui/core, [architecture](../../architecture.md), [post-MVP roadmap](../../post-mvp.md), [README](../../../README.md), and all PM3 records.

## Tests

Vitest: rate-limit boundary and disabling, rotation and compensation, last-use, plaintext non-persistence, redaction, expiry/revocation, scope/ABAC, admin 2FA management, and the admin UI. Integration: real PostgreSQL (run) and the Docker example (run by the project owner; passes).

## Acceptance Criteria

- [x] Rate limits are tested.
- [x] Rotation is tested.
- [x] Logs and errors redact secrets.
- [x] Resource API integration passes.
- [x] Admin 2FA/key-management integration passes.
- [x] Docs updated.
- [x] Initiative definition of done passes and PM3 is marked complete.

## Validation

`pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, biome, `git diff --check`; `nestrum db generate/migrate` and `verify:api-keys` on PostgreSQL 16. The Docker + MongoDB `pnpm test:integration` cannot run in this environment (no Docker daemon); the project owner ran it, including the API-key section, and it passes.

## Known Limitations

Organization and service-identity owners, external (Redis) rate-limit providers, and grace-period rotation are not implemented. The plugin logs each failed verification at error level (codes only). Expired keys are removed by the plugin rather than marked.

## Follow-Ups

Record service identities, broader transports, external rate-limit adapters, and additional key policy controls in the post-MVP roadmap after PM3 completion.

## Completion Notes

PM3 is complete; the Docker + MongoDB integration suite passes (run by the project owner).
