# PM2.0 — Admin 2FA Contract

## Status

Complete

## Goal

Document default-required admin 2FA, session assurance semantics, TOTP enrollment/challenge, recovery behavior, and admin enforcement boundaries before implementation.

## Scope

- Create the [PM2 admin 2FA initiative index](README.md) and five bounded phase records.
- Define default-required behavior, explicit opt-out diagnostics, assurance levels/expiry, TOTP enrollment, challenge, recovery, routes, and error behavior.
- Define testing expectations and the security boundary with Better Auth, `admin.access`, and same-origin policy.
- Link the initiative from the post-MVP roadmap, architecture, and documentation index.

## Out of Scope

Any auth/database/UI implementation, new dependencies, route changes, TOTP secret generation, recovery storage, or current enforcement behavior.

## Architecture Decisions

Better Auth remains the authentication foundation. Nestrum adds an admin-specific current-session assurance layer. Configured 2FA and satisfied session assurance are distinct. The authorization order is authentication → assurance → `admin.access` → resource/action ABAC. Browser requests may redirect to framework-owned pages; admin API requests return structured `ADMIN_2FA_REQUIRED` errors.

TOTP is the initial factor. The abstraction must leave room for WebAuthn/passkeys. Recovery plaintext is never retained after issuance. PM2.1 finalizes the assurance API and defaults; later phases own persistence, route enforcement, UI, and hardening.

## Implementation

Added the initiative index and PM2.0–PM2.5 phase records. PM2.0 is complete; PM2.1–PM2.5 remain Not Started. No runtime/auth/admin code changed.

## Public API

Documents planned `admin.security.twoFactor`, assurance levels, `/admin/auth/2fa*`, `/__admin/auth/2fa/*`, and `ADMIN_2FA_REQUIRED`. No exports or executable behavior are added.

## Files / Packages Changed

New `docs/post-mvp/admin-2fa/` documents plus updates to `docs/post-mvp.md`, `docs/architecture.md`, and `docs/README.md`. No package changes.

## Tests

Documentation validation only: required files/sections, relative links, and whitespace. Runtime/auth tests are deferred to implementation phases.

## Acceptance Criteria

- [x] Default-required behavior documented.
- [x] Session assurance semantics documented.
- [x] TOTP and recovery behavior documented.
- [x] Admin enforcement boundaries documented.
- [x] Phase records and roadmap links created.

## Validation

Verify all six records, local links, standard sections, and `git diff --check`. No runtime test is expected for this documentation-only phase.

## Known Limitations

The plan does not enforce 2FA yet. Exact Better Auth integration, persistence schema, secret/key handling, route response shapes, and TTL clock semantics are implementation decisions.

## Follow-Ups

[PM2.1](phase-01-assurance.md) defines and tests the framework assurance abstraction. The remaining MVP atomic object-policy write gate remains independent.

## Completion Notes

PM2.0 documents the initiative and prepares implementation boundaries. It does not imply that admin 2FA is enabled in the current runtime.
