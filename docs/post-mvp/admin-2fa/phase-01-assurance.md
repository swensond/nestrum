# PM2.1 — Session Assurance

## Status

Complete

## Goal

Give admin an explicit, server-authoritative notion of whether the current session has satisfied the second factor, built on Better Auth's `twoFactor` plugin rather than a parallel implementation.

## Scope

- Wire Better Auth's `twoFactor` plugin into `defineAuth` (issuer and lockout configurable) and persist its `TwoFactor` table and `User.twoFactorEnabled` through a prebaked auth contract.
- Define the admin policy `admin.security.twoFactor.{required, assuranceTtlSeconds}` with validation.
- Define how a Better Auth session is judged to have satisfied the factor (`sessionAssurance`).

## Out of Scope

TOTP generation/verification, backup codes, and lockout (all owned by the plugin), admin route middleware (PM2.3), Svelte pages (PM2.4), WebAuthn, and browser hardening (PM2.5).

## Architecture Decisions

Depends on [PM2.0](phase-00-contract.md). **Better Auth's plugin, not custom code.** The plugin challenges at sign-in: for a user with `twoFactorEnabled`, password sign-in creates no session until a TOTP or backup code is verified. A live session of such a user has therefore passed the second factor, so admin assurance is derived from session fields instead of a separate table.

This changes one contract in the original plan: assurance cannot expire *independently* of the login session, because the plugin only verifies during sign-in. `assuranceTtlSeconds` instead bounds the age of the session for admin purposes; an older session is denied with `challenge-required` and the user signs in again (which repeats the challenge). The login session itself is not shortened or revoked.

## Implementation

- **Plugin wiring** (`packages/auth/src/auth.ts`, `createAuthInstance`): `twoFactor({ issuer, twoFactorTable: 'TwoFactor', accountLockout })`. `defineAuth({ twoFactor: { issuer, maxFailedAttempts, lockoutSeconds } })` defaults to issuer "Nestrum", 10 failed attempts, and 900 s (the plugin's own defaults, validated). The auth route allowlist gains `POST /api/auth/two-factor/{enable, disable, verify-totp, verify-backup-code, generate-backup-codes}`; OTP-by-message, `get-totp-uri`, and trusted-device flows stay unexposed.
- **Prebaked contract** (`packages/auth/src/contracts/contracts.ts`): `authContract(provider)` returns one of two fixed Prisma sources (PostgreSQL, MongoDB) for `User` (now with `twoFactorEnabled`), `Session`, `Account`, `Verification`, and `TwoFactor`. A test builds the real Better Auth instance and compares every model and field with both sources, so a Better Auth upgrade that changes the schema fails loudly. `defineAuth({ extend })`, `field`, and `AuthField` were **removed**: user extensions were the only reason the contract had to be assembled dynamically. Application-specific user data belongs in an application-owned model keyed by user id.
- **Assurance rule** (`packages/admin/src/security.ts`, `sessionAssurance`): `setup-required` unless `user.twoFactorEnabled === true`; otherwise `challenge-required` if the session is older than `assuranceTtlSeconds`, if it was created before the user's last update (enabling 2FA updates the user, so a single-factor session that predates enrollment never satisfies admin), or if either timestamp is missing or unparsable; otherwise satisfied. The verified session Better Auth creates on activation has the same instant as the enrollment update, so the comparison is "not older".
- **Configuration**: `defineAdmin({ security: { twoFactor: { required?, assuranceTtlSeconds? } } })`. `required` defaults to `true`; `assuranceTtlSeconds` defaults to 43200 and must be an integer from 60 to 2592000, validated even when 2FA is disabled. The resolved policy is `AdminDefinition.security.twoFactor` and `Application.adminSecurity`, known before startup.

## Public API

`defineAdmin({ security })`, `resolveTwoFactorPolicy`, `sessionAssurance`, `DEFAULT_ASSURANCE_TTL_SECONDS` (`@nestrum/admin`); `AdminTwoFactorPolicy`, `AdminTwoFactorRequiredError` (`@nestrum/core`); `defineAuth({ twoFactor })`, `authContract(provider)` (`@nestrum/auth`). Removed: `defineAuth({ extend })`, `field`, `AuthField`, and the `authContract` extension argument.

## Files / Packages Changed

`packages/auth` (plugin wiring, static contracts, drift test), `packages/admin` (`security.ts`), `packages/core` (admin policy/error types, `Application.adminSecurity`), tests, [architecture](../../architecture.md), [initiative index](README.md), and this record.

## Tests

Auth: the contract-drift test and plugin integration (`packages/auth/tests/two-factor.test.ts`). Admin: policy defaults, TTL validation, opt-out, and every branch of `sessionAssurance` (`packages/admin/tests/two-factor.test.ts`).

## Acceptance Criteria

- [x] Admin can tell whether the current session satisfied the second factor, separately from configured state.
- [x] Assurance is derived from Better Auth's plugin, with no parallel TOTP implementation.
- [ ] ~~Assurance expires independently from the session.~~ **Not met as written**: it is bounded by session age (see Architecture Decisions).
- [x] Default and opt-out configuration are validated and documented.
- [x] Tests pass.
- [x] Docs updated.

## Validation

`pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, `git diff --check`. The static identity contract was generated, planned, applied, and status-checked with `nestrum db` on a local PostgreSQL 16 and the `TwoFactor` table was inspected.

## Known Limitations

Existing applications must generate and apply a migration for `User.twoFactorEnabled` and the `TwoFactor` table (nothing migrates automatically). The 2FA challenge applies to every sign-in for a user who enables it, not only admin. Rotating `AUTH_SECRET` invalidates stored TOTP secrets (the plugin encrypts them with it). Removing `extend.user` is a breaking change to the Phase 10 auth API.

## Follow-Ups

[PM2.2](phase-02-enrollment.md) covers enrollment and recovery through the plugin.

## Completion Notes

PM2.1 is complete. An earlier iteration implemented TOTP, recovery codes, lockout, and a per-session assurance table in Nestrum; it was replaced by the plugin so the framework does not own security-sensitive factor code. `admin.access` is decided before assurance is disclosed, so users without admin access learn nothing about their factor state; both checks are always enforced.
