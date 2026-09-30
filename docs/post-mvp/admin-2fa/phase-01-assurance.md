# PM2.1 — Session Assurance

## Status

Not Started

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

Planned assurance context/service with explicit current level, factor/challenge timestamp, and expiry. Resolve how state is stored or projected from Better Auth without exposing secrets. Default admin requirement is true; explicit false is supported only with a visible development warning.

## Public API

Planned internal/framework assurance contracts and admin security configuration. Publish only the minimum stable surface needed by auth/admin; document names and serialization after implementation.

## Files / Packages Changed

Planned auth/core/admin contracts, tests, configuration types, [architecture](../../architecture.md), [initiative index](README.md), and this record.

## Tests

Cover current assurance reporting, configured-versus-satisfied distinction, independent expiry, valid/invalid TTL, default-required configuration, and opt-out diagnostics contract.

## Acceptance Criteria

- [ ] Current session exposes assurance state.
- [ ] Assurance is independent from simple authentication state.
- [ ] Assurance expires independently from the session.
- [ ] Default/opt-out configuration is validated and documented.
- [ ] Tests pass.
- [ ] Docs updated.

## Validation

Run targeted assurance tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, and `git diff --check`.

## Known Limitations

No TOTP enrollment or admin enforcement yet. Storage and Better Auth adapter details must remain compatible with later recovery/challenge phases.

## Follow-Ups

[PM2.2](phase-02-enrollment.md) uses the abstraction for TOTP setup and recovery.

## Completion Notes

Pending implementation and validation.
