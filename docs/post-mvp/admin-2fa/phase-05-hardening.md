# PM2.5 — Admin 2FA Hardening

## Status

Not Started

## Goal

Complete assurance expiry, re-challenge, security diagnostics, error handling, and browser-level verification.

## Scope

- Enforce assurance TTL and re-challenge after expiry while preserving a valid login session.
- Add complete Playwright enrollment/challenge/recovery/return-route coverage.
- Verify no admin UI/API bypass, including direct private API and route variations.
- Harden error handling, redaction, rate/attempt behavior as required by the implementation, and development opt-out diagnostics.
- Update architecture, roadmap, phase records, and definition-of-done status to actual behavior.

## Out of Scope

Passkeys/WebAuthn implementation, optional non-admin MFA policy, automatic database migration behavior, and unrelated admin redesign.

## Architecture Decisions

Depends on PM2.1–PM2.4. Expiry is independent from login validity and must be checked server-side on every protected admin boundary. Browser and API behavior remain distinct. Any rate limiting, lockout, or retry policy introduced must be explicit, tested, and avoid turning recovery into a bypass. Production diagnostics never expose secrets or assurance internals.

## Implementation

Planned end-to-end verification of setup-required, challenge-required, verified, expired, recovery-used, and ABAC-denied states. Ensure dev reports `2FA required yes` by default and warns on explicit disablement. Record actual supported TTL, clock, status/error, cache, and deployment behavior.

## Public API

Finalize assurance expiry, challenge errors, route behavior, diagnostics, and any configuration options. Update the initiative index and architecture only to describe shipped behavior.

## Files / Packages Changed

Planned integration tests/fixtures, CLI diagnostics, auth/admin/admin-ui hardening, [architecture](../../architecture.md), [post-MVP roadmap](../../post-mvp.md), and all PM2 records.

## Tests

Vitest: assurance expiry, re-challenge, ABAC after challenge, recovery reuse, structured errors, and bypass attempts. Playwright: enrollment, invalid/valid TOTP, recovery, return route, expiry/re-challenge, direct API, and same-origin behavior.

## Acceptance Criteria

- [ ] Browser flow passes end to end.
- [ ] Assurance expiry and re-challenge are tested.
- [ ] No admin bypass exists.
- [ ] Security diagnostics and error handling are verified.
- [ ] Docs describe actual implementation.
- [ ] Initiative definition of done passes and PM2 is marked complete.

## Validation

Run targeted security/browser integration, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, `svelte-check-native`, and `git diff --check`. Record evidence before marking Complete.

## Known Limitations

Future WebAuthn/passkey support and broader MFA policy remain deferred unless separately planned. Document any factor/provider limitations demonstrated by the implementation.

## Follow-Ups

Record future factors, configurable policy extensions, and operational controls in the post-MVP roadmap after PM2 completion.

## Completion Notes

Pending implementation and validation. PM2 is incomplete until all phases and definition-of-done items pass.
