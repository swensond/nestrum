# PM2.2 — TOTP Enrollment and Recovery

## Status

Complete

## Goal

Enroll TOTP and issue recovery (backup) codes through Better Auth's `twoFactor` plugin, with framework-owned pages driving it.

## Scope

- Expose the plugin's `enable`, `verify-totp`, `verify-backup-code`, `generate-backup-codes`, and `disable` endpoints under `/api/auth/two-factor/*`.
- Enrollment is inactive until a valid TOTP is verified; backup codes are one-time.
- Nestrum adds no factor storage, cryptography, or endpoints of its own.

## Out of Scope

Admin-wide enforcement (PM2.3), Svelte pages (PM2.4), WebAuthn/passkeys, OTP by email/SMS, trusted devices, and any bespoke crypto.

## Architecture Decisions

Depends on [PM2.1](phase-01-assurance.md). The plugin owns secrets (encrypted with the auth secret), backup codes (stored encrypted as one column and consumed on use), TOTP verification, and account lockout. Enrollment needs an authenticated session and the user's password (`allowPasswordless` is not enabled). The plugin's private-route plan (`/__admin/auth/2fa/*`) was dropped: the browser talks to Better Auth's same-origin endpoints directly, which keeps a single implementation and one origin/cookie policy.

## Implementation

- **Flow.** `POST /api/auth/two-factor/enable {password}` returns `{ totpURI, backupCodes }` and leaves `twoFactorEnabled` false; `POST .../verify-totp {code}` activates the factor, sets `twoFactorEnabled`, and replaces the enrolling session with a verified one (the browser keeps the new cookie). A wrong code returns 401 and activates nothing; calling `enable` again replaces an unfinished secret.
- **Sign-in.** For an enrolled user, `POST /api/auth/sign-in/email` returns `{ twoFactorRedirect: true }` and sets a short-lived signed cookie but no session. `verify-totp` or `verify-backup-code` with that cookie creates the session. A backup code works once.
- **Lockout.** The plugin counts consecutive failures per account (10 attempts, 900 s by default; `defineAuth({ twoFactor: { maxFailedAttempts, lockoutSeconds } })`) and answers `429` while locked, even for a correct code.
- **Backup codes** are returned by `enable` (before activation) and are not retrievable afterwards; `generate-backup-codes` (needs a verified session and the password) replaces the set.

## Public API

Better Auth endpoints `POST /api/auth/two-factor/{enable, disable, verify-totp, verify-backup-code, generate-backup-codes}` and the `twoFactorRedirect` sign-in response. Responses never contain the stored (encrypted) secret; `enable` returns the secret only inside the `otpauth://` URI, once.

## Files / Packages Changed

`packages/auth` (allowlist, plugin options, test helper `totpCode`/`totpStep`/`totpSecretFromUri` in `testing.ts` — a test/tooling aid only, not used in production paths), tests, [architecture](../../architecture.md), [initiative index](README.md), and this record.

## Tests

`packages/auth/tests/two-factor.test.ts`: enrollment inactive until verified, protected secret storage, sign-in yields no session until verified, backup-code single use, lockout after the configured failures (correct code refused), and that unsanctioned two-factor endpoints return 404. `packages/admin/tests/two-factor.test.ts` repeats the flows through the admin boundary.

## Acceptance Criteria

- [x] Setup is inactive until verified.
- [x] Recovery codes are one-time use.
- [x] Plaintext recovery codes are not persisted (the plugin stores them encrypted).
- [x] Enrollment/recovery endpoints work.
- [ ] ~~Regeneration invalidates the previous set.~~ Provided by the plugin's `generate-backup-codes`; exposed but not covered by a Nestrum test or UI.
- [x] Docs updated.

## Validation

`pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`; the full flow was also run against a local PostgreSQL 16 database migrated with `nestrum db`, driven by Chromium (see PM2.5).

## Known Limitations

No rendered QR image (the `otpauth://` link and the key are shown). No UI for regenerating backup codes or disabling 2FA. No factor reset for another user. Recovery-code regeneration relies on the plugin and is untested here.

## Follow-Ups

[PM2.3](phase-03-challenge.md) enforces assurance on admin.

## Completion Notes

PM2.2 is complete. Replacing the earlier bespoke TOTP with the plugin removed roughly 500 lines of security-sensitive code and their tests.
