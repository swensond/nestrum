# PM3.1 — Key Generation and Storage

## Status

Not Started

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

Planned key service and persistence contract with owner types `user` and `organization`, timestamps, scope/metadata snapshots, and revocation. Integrate migration/contract workflow without deleting revoked records. Keep key format/environment prefix stable once published.

## Public API

Planned internal key creation, verification, revocation, and rotation contracts. Document admin-facing response fields and one-time secret behavior after implementation.

## Files / Packages Changed

Planned auth/core storage/service code, migrations/contracts, tests, [architecture](../../architecture.md), [initiative index](README.md), and this record.

## Tests

Cover randomness/format, hash verification, plaintext non-persistence, one-time reveal, expiry metadata, revocation metadata, ownership mapping, and safe logging/errors.

## Acceptance Criteria

- [ ] Secret is never persisted.
- [ ] Secret is shown only once.
- [ ] Hash verification works.
- [ ] Expiry and revocation metadata work.
- [ ] Docs updated.

## Validation

Run targeted storage tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, applicable migration/compiled checks, and `git diff --check`.

## Known Limitations

Stored keys are not accepted by resource APIs until PM3.2. Rate-limit enforcement and admin management follow later.

## Follow-Ups

[PM3.2](phase-02-authentication.md) verifies requests and constructs API-key subjects.

## Completion Notes

Pending implementation and validation.
