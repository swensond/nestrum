# PM3.1 — Key Generation and Storage

## Status

Complete

## Goal

Implement secure API-key generation, hashing, one-time reveal, expiration metadata, and revocation metadata.

## Scope

- Generate recognizable, cryptographically random keys and safe prefixes.
- Persist only identifier/prefix, secure hash, ownership, metadata, scopes, timestamps, and rate-limit configuration.
- Verify hashes without retaining plaintext.
- Support no expiry, explicit expiry, default TTL, and `revokedAt` state.
- Provide a secure one-time creation/rotation result.

## Out of Scope

Request authentication, resource auth modes, scope enforcement, admin UI/API, rate-limit enforcement, and final rotation hardening.

## Architecture Decisions

Depends on [PM3.0](phase-00-contract.md). Use a modern cryptographic hash/verification design appropriate to the runtime and document it. Prefix/identifier lookup must not become a secret oracle. Creation responses are the only plaintext reveal point; logs, errors, persistence, and later reads are redacted.

## Implementation

- **Plugin-owned storage.** `defineAuth` enables `@better-auth/api-key` (config id `default`, `references: 'user'`, `requireName`, `enableMetadata`, hashing on, `enableSessionForAPIKeys` off). The plugin generates the key (`nes_live_` + 64 random letters by default), stores only its SHA-256 hash plus a recognizable `start` (prefix + 4 characters), and returns the plaintext once from `createApiKey`. Nestrum writes no key cryptography.
- **Contract.** The prebaked auth contract gains `ApiKey` (plugin table `apikey` mapped with `schema.apikey.modelName`) for PostgreSQL and MongoDB; `ApiKey` joins `AUTH_MODELS` and the protected auth models. The drift test compares it with Better Auth's own schema for the configured plugins. The generated PostgreSQL migration adds one table and two indexes (verified with `nestrum db generate/migrate` on PostgreSQL 16).
- **Service.** `createApiKeys()` (`@nestrum/auth`, `ApiKeys` in `@nestrum/core`) validates input (name 1–64, owner user must exist, `resource:action` scopes, whole-day expiry up to `maxTtlDays`, bounded rate limit, small metadata without reserved names) and calls the plugin's server-side endpoints with the owner's id. Summaries (`ApiKeySummary`) never contain the secret or hash.
- **Options.** `defineAuth({ apiKeys: { prefix, defaultTtlDays, maxTtlDays, rateLimit: { enabled, requests, windowSeconds } } })`, validated at definition time; defaults are prefix `nes_live_`, no default expiry, 365-day maximum, 1000 requests per 60 seconds.
- **State.** No expiry, explicit expiry, and default TTL are supported. Revocation sets `enabled: false` and records `revokedAt` in metadata; the row is kept. The plugin deletes an expired key when it is next verified.

## Public API

`defineAuth({ apiKeys })` and the request-independent `application.auth.apiKeys` service: `create`, `list`, `revoke`, `rotate`, `authenticate`. `create` returns `{ key: ApiKeySummary, secret }`; the secret exists only in that return value. Summary fields: `id`, `name`, `start`, `owner`, `scopes`, `status`, `createdAt`, `expiresAt`, `lastUsedAt`, `revokedAt`, `rateLimit`, `metadata`.

## Files / Packages Changed

`packages/core/src/auth/api-key.ts` (types, scope helpers, errors), `packages/auth` (`src/api-keys/`, contracts, `defineAuth`), `packages/core` resource registration, tests, [decision 0015](../../decisions/0015-api-keys.md), [architecture](../../architecture.md), the [initiative index](README.md), and this record.

## Tests

`packages/auth/tests/api-keys.test.ts` (Vitest, real Better Auth against the in-memory collection fixture): format and randomness, one-time reveal, hash-only persistence, later reads without secrets, default TTL and custom prefix, input and owner validation, revocation metadata and idempotence, pagination and owner filtering, and log redaction. `packages/core/tests/api-keys.test.ts`: scope vocabulary. `apps/example/tooling/api-keys-postgres.mjs`: real PostgreSQL storage.

## Acceptance Criteria

- [x] Secret is never persisted.
- [x] Secret is shown only once.
- [x] Hash verification works.
- [x] Expiry and revocation metadata work.
- [x] Docs updated.

## Validation

`pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, biome, and `git diff --check` pass. `nestrum db generate`, `db migrate --plan`, and `db migrate` for the identity database, and `pnpm --filter @nestrum/example verify:api-keys`, pass against local PostgreSQL 16.

## Known Limitations

Only `user` owners (organization owners need Better Auth's organization plugin). Expired keys are deleted by the plugin rather than marked. The MongoDB auth contract is covered by the drift test only: Prisma's MongoDB interpreter requires `ObjectId` ids, which every auth model (not only `ApiKey`) lacks, so it is unchanged from the earlier auth phases and unverified against a live MongoDB.

## Follow-Ups

[PM3.2](phase-02-authentication.md) verifies requests and constructs API-key subjects.

## Completion Notes

Pending implementation and validation.
