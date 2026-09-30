# PM2.2 — TOTP Enrollment and Recovery

## Status

Not Started

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

Planned private API under `/__admin/auth/2fa/*`: status, enrollment start, enrollment confirmation, recovery verification, and recovery regeneration. Exact persistence tables/fields and TOTP library choice must follow current Better Auth/dependency policy and be documented with versioned behavior.

## Public API

Planned framework admin API status/enrollment/recovery responses. Never expose secret material after setup confirmation or return stored plaintext recovery codes.

## Files / Packages Changed

Planned auth/admin persistence and service code, private routes, tests, migration/contract docs as needed, [architecture](../../architecture.md), [initiative index](README.md), and this record.

## Tests

Cover setup generation, invalid confirmation, valid confirmation, activation only after verification, recovery generation/hash-at-rest inspection, one-time use, reuse rejection, regeneration invalidation, and authorization/origin checks.

## Acceptance Criteria

- [ ] Setup is inactive until verified.
- [ ] Recovery codes are cryptographically generated.
- [ ] Recovery codes are one-time use.
- [ ] Plaintext recovery codes are not persisted.
- [ ] Regeneration invalidates the previous set.
- [ ] Private enrollment/recovery API works.
- [ ] Docs updated.

## Validation

Run targeted auth/admin tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, and applicable migration/compiled checks. Record dependency/storage decisions and `git diff --check`.

## Known Limitations

The normal `/admin/*` and `/__admin/*` boundaries do not yet require assurance; PM2.3 adds enforcement.

## Follow-Ups

[PM2.3](phase-03-challenge.md) enforces challenge completion and structured API errors.

## Completion Notes

Pending implementation and validation.
