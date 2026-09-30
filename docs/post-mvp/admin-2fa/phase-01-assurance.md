# PM2.1 — Session Assurance

## Status

Complete

## Goal

Implement an explicit framework-level assurance abstraction for the current authenticated session.

## Scope

- Model at least `single-factor` and `two-factor` assurance levels.
- Expose current-session assurance separately from authentication/configured-factor state.
- Attach assurance to the current session/challenge context and expire it independently from login.
- Define default-required admin configuration and `assuranceTtlSeconds` validation.
- Provide a testable service/context seam for later enrollment and admin enforcement.

## Out of Scope

TOTP generation/verification, recovery persistence, admin route middleware, Svelte pages, WebAuthn, and final E2E hardening.

## Architecture Decisions

Depends on [PM2.0](phase-00-contract.md). Preserve Better Auth session ownership; do not fork login/session identity. A configured factor is not assurance. TTL checks must be server-authoritative and robust to expiry/clock boundaries. Keep factor types extensible without weakening the required two-factor decision.

## Implementation

- **Vocabulary** (`@nestrum/core`, `auth/auth.types.ts`): `AssuranceLevel` (`single-factor` | `two-factor`), `AssuranceMethod` (`totp` | `recovery`), `SessionAssurance` (`level`, `configured`, `method?`, `verifiedAt?`, `expiresAt?`), and the `TwoFactorService` seam exposed as `Authentication.twoFactor`. `configured` (the user has an active factor) and `level` (this session satisfied a challenge) are separate fields.
- **Storage** (`@nestrum/auth`): assurance is a framework-owned `AdminAssurance` row keyed by the Better Auth **session id** (unique), with `userId`, `method`, `verifiedAt`, and `expiresAt`. A new login is a new session and therefore starts single-factor; Better Auth's `Session`, cookies, and login lifetime are untouched. On PostgreSQL the row cascades when the session is deleted (sign-out, expiry cleanup); on MongoDB, stale rows are pruned for the user at the next grant. Reading assurance requires an active factor, a row for this session and user, and `expiresAt > now` (expiry is exclusive and server-authoritative).
- **Configuration** (`@nestrum/admin`, `security.ts`): `defineAdmin({ security: { twoFactor: { required?, assuranceTtlSeconds? } } })`. `required` defaults to `true`; `assuranceTtlSeconds` defaults to 43200 (12 hours) and must be an integer from 60 to 2592000 (30 days), validated even when 2FA is disabled. Unknown keys and non-plain objects are rejected with `ADMIN_CONFIG_INVALID`. The resolved policy is `AdminDefinition.security.twoFactor` and `Application.adminSecurity`, both available before startup.
- **Clock seam.** `defineAuth({ twoFactor: { now } })` injects the clock used for TOTP steps, lockout, and assurance expiry; production uses `Date.now`.

## Public API

`AssuranceLevel`, `AssuranceMethod`, `SessionAssurance`, `TwoFactorService`, `TwoFactorEnrollment`, `TwoFactorGrant`, `AdminTwoFactorPolicy`, `AdminTwoFactorRequiredError` (`@nestrum/core`); `defineAdmin({ security })`, `resolveTwoFactorPolicy`, `DEFAULT_ASSURANCE_TTL_SECONDS` (`@nestrum/admin`); `defineAuth({ twoFactor: { issuer, now } })`, `TWO_FACTOR_MODELS` (`@nestrum/auth`). The three new models are protected auth models and cannot be registered as resources.

## Files / Packages Changed

`packages/core` (auth types, admin types/errors, `Application.adminSecurity`), `packages/auth` (contract models, `two-factor/service.ts`, adapter helper), `packages/admin` (`security.ts`), tests, [architecture](../../architecture.md), [initiative index](README.md), and this record.

## Tests

Cover current assurance reporting, configured-versus-satisfied distinction, independent expiry, valid/invalid TTL, default-required configuration, and opt-out diagnostics contract.

## Acceptance Criteria

- [x] Current session exposes assurance state.
- [x] Assurance is independent from simple authentication state.
- [x] Assurance expires independently from the session.
- [x] Default/opt-out configuration is validated and documented.
- [x] Tests pass.
- [x] Docs updated.

## Validation

`pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check` and `git diff --check`; targeted `packages/auth/tests/two-factor.test.ts` (assurance states, independent expiry, per-session isolation, contract shape) and `packages/admin/tests/two-factor.test.ts` (policy defaults, TTL validation, opt-out). The identity contract was generated, planned, applied, and status-checked against a local PostgreSQL 16 with `nestrum db`, and the resulting `AdminAssurance` table (unique `sessionId`, cascade to `Session`) was inspected.

## Known Limitations

Existing applications must generate and apply a migration for the three new auth models before admin 2FA can work (nothing migrates automatically). The assurance TTL is stored per grant, so changing the configured TTL affects only later challenges.

## Follow-Ups

[PM2.2](phase-02-enrollment.md) uses the abstraction for TOTP setup and recovery.

## Completion Notes

PM2.1 is complete. One deliberate refinement of the README precedence: `admin.access` is decided before assurance is revealed, so a user who may not use administration learns nothing about their factor state. Both checks are always enforced; only which error is reported first differs. See PM2.3.
