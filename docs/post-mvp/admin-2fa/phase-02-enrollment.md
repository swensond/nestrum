# PM2.2 — TOTP Enrollment and Recovery

## Status

Complete

## Goal

Implement framework-owned TOTP setup/confirmation and secure recovery codes.

## Scope

- Generate TOTP secrets and QR/`otpauth` enrollment information.
- Require a valid TOTP before marking 2FA configured/active.
- Generate cryptographically secure recovery codes, hash them at rest, and show plaintext only once.
- Support one-time recovery use and regeneration that invalidates the previous set.
- Provide private status/start/confirm and recovery endpoints for the later UI.

## Out of Scope

Admin-wide challenge enforcement, Svelte pages, WebAuthn/passkeys, recovery plaintext retrieval, automatic migrations, and final expiry hardening.

## Architecture Decisions

Depends on [PM2.1](phase-01-assurance.md). Enrollment belongs to the framework and is available only after authentication and appropriate admin authorization. Secret and recovery-code handling must use cryptographically secure generation and protected storage; plaintext recovery codes are response-only issuance data. Activation is transactional from the user's perspective: an unverified secret cannot satisfy assurance.

## Implementation

- **TOTP.** RFC 6238 (HMAC-SHA1, 30 s period, 6 digits, ±1 step window) implemented on `node:crypto` in `packages/auth/src/two-factor/totp.ts` and verified against the RFC vectors; the 20-byte secret is CSPRNG-generated and shown base32. No third-party TOTP dependency was added. Each accepted time step is single-use (`lastUsedStep`), so a code cannot be replayed, including the code used to confirm enrollment.
- **Persistence** (three auth-owned models, added to the identity database contract): `TwoFactorFactor` (one per user: encrypted `secret`, `confirmedAt` — `null` while pending — `lastUsedStep`, `failedAttempts`, `lockedUntil`), `TwoFactorRecoveryCode` (`codeHash`, `usedAt`), and `AdminAssurance` (PM2.1).
- **Secret protection.** The TOTP secret is stored as AES-256-GCM (`v1.<iv>.<ciphertext>.<tag>`), with a key derived by HKDF-SHA-256 from the auth secret and a purpose label. Rotating `AUTH_SECRET` therefore invalidates stored TOTP secrets (users re-enroll or use recovery codes handled by an operator); this is documented behavior.
- **Recovery codes.** Ten codes of 60 random bits (`XXXX-XXXX-XXXX`, unambiguous alphabet, `crypto.randomInt`), stored only as HMAC-SHA-256 hashes (separately derived key). Codes are case-, space-, and dash-insensitive. A code is claimed with a compare-and-set on `usedAt`, so concurrent use of one code succeeds once. Regeneration deletes the whole previous set first and then issues a new one (a failure part-way leaves fewer codes, never a still-valid old set).
- **Enrollment.** `beginEnrollment` refuses when a factor is already confirmed, replaces any abandoned pending secret, and returns the base32 secret and `otpauth://` URI (issuer from `defineAuth({ twoFactor: { issuer } })`, default "Nestrum"). Nothing is configured or asserted until `confirmEnrollment` verifies a TOTP; confirmation then activates the factor, issues recovery codes, and grants assurance to the confirming session.
- **Private API** (`packages/admin/src/two-factor-routes.ts`, all `Cache-Control: no-store`, JSON bodies of exactly `{ "code": string }`): `GET /__admin/auth/2fa/status`, `POST .../enroll/start` (201), `.../enroll/confirm`, `.../challenge`, `.../recovery/verify`, `.../recovery/regenerate`. Secret and recovery-code material appears only in the single response that issues it.

## Public API

`TwoFactorService` methods `beginEnrollment`, `confirmEnrollment`, `verifyTotp`, `verifyRecovery`, `regenerateRecoveryCodes`; error codes `TWO_FACTOR_INVALID_CODE` (400), `TWO_FACTOR_LOCKED` (429), `TWO_FACTOR_NOT_CONFIGURED`, `TWO_FACTOR_ALREADY_CONFIGURED`, `TWO_FACTOR_ENROLLMENT_NOT_STARTED` (409); exported helpers `totpCode`, `totpStep`, `TOTP_PERIOD_SECONDS`, `RECOVERY_CODE_COUNT`, `MAX_FAILED_ATTEMPTS`, `LOCKOUT_SECONDS`. Response shapes: status `{ required, level, configured, method?, expiresAt? }`; confirm `{ assurance, recoveryCodes }`; challenge `{ assurance }`; recovery verify `{ assurance, recoveryCodesRemaining }`; regenerate `{ recoveryCodes }`.

## Files / Packages Changed

`packages/auth` (`two-factor/{totp,crypto,service}.ts`, contract, adapter helper, tests and fixtures, `tsconfig` Node types), `packages/admin` (`two-factor-routes.ts`), `packages/core` types, [architecture](../../architecture.md), [initiative index](README.md), and this record.

## Tests

Cover setup generation, invalid confirmation, valid confirmation, activation only after verification, recovery generation/hash-at-rest inspection, one-time use, reuse rejection, regeneration invalidation, and authorization/origin checks.

## Acceptance Criteria

- [x] Setup is inactive until verified.
- [x] Recovery codes are cryptographically generated.
- [x] Recovery codes are one-time use.
- [x] Plaintext recovery codes are not persisted.
- [x] Regeneration invalidates the previous set.
- [x] Private enrollment/recovery API works.
- [x] Docs updated.

## Validation

Targeted auth and admin suites (`two-factor.test.ts`): RFC vectors, encryption round trip and tamper rejection, unconfirmed secrets granting nothing, recovery hash-at-rest inspection, one-time use, cross-user rejection, regeneration invalidation, and origin/authorization checks; then `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`. The full enrollment, challenge, replay-rejection, recovery-single-use, lockout, and expiry sequence was also executed through the real HTTP runtime against a local PostgreSQL 16 database migrated with `nestrum db`.

## Known Limitations

Enrollment shows the `otpauth://` link and manual key, not a rendered QR image (no QR dependency was added). Recovery-code regeneration is the only recovery-code management; there is no factor removal or reset flow (an operator clears the factor row). Compare-and-set is used instead of database transactions because the auth adapter is not transactional.

## Follow-Ups

[PM2.3](phase-03-challenge.md) enforces challenge completion and structured API errors.

## Completion Notes

PM2.2 is complete. Choosing our own TOTP over Better Auth's `twoFactor` plugin kept the auth route allowlist unchanged, keeps assurance per-session rather than per-cookie, and avoids a new dependency; the trade-off is that the framework owns the (small) RFC 6238 implementation and its tests.
