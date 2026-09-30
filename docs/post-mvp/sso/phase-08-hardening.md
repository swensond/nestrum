# PM6.8 — SSO Hardening

## Status

Not Started

## Goal

Complete diagnostics, redaction, audit, fixtures, and end-to-end verification, then mark PM6 complete.

## Scope

- Provider diagnostics and validation status: OIDC discovery failed, issuer mismatch, provider ID collision, missing client secret, invalid SAML metadata, invalid certificate, domain unverified, callback origin untrusted, organization missing, provider disabled.
- Safe logging only (provider ID, protocol, organization ID, error category, request ID, trace ID); tests prove client secrets, tokens, raw ID tokens, SAML assertions and private keys never reach logs or diagnostics.
- Audit seam verified for every configuration change.
- OIDC and SAML test fixtures, IdP-initiated SAML tests, disabled-provider tests, domain verification tests.
- Playwright management tests for both protocol lifecycles; update architecture, roadmap, and all PM6 records to actual behavior.

## Out of Scope

Trusting upstream MFA, OAuth2-only providers, and a full audit-history product.

## Architecture Decisions

Depends on PM6.1–PM6.7. Disabled providers reject new SSO sign-ins. Admin 2FA cannot be bypassed by an SSO session. Diagnostics disclose categories, never credentials.

## Implementation

Planned final workflow checks and documentation of demonstrated behavior, provider limitations, and delete/account-cleanup semantics.

## Public API

Finalize diagnostics, audit event, fixture, and provider-status contracts.

## Files / Packages Changed

Planned integration fixtures, Playwright scripts, security tests, architecture, post-MVP roadmap, and all PM6 records.

## Tests

Vitest for redaction, audit, disabled providers, domain verification, and fixtures; Playwright for the OIDC and SAML admin workflows; integration for SSO login through SubjectFactory and ABAC.

## Acceptance Criteria

- [ ] OIDC admin workflow E2E passes.
- [ ] SAML admin workflow E2E passes.
- [ ] Disabled providers reject new SSO login.
- [ ] Sensitive material never logged.
- [ ] Admin 2FA cannot be bypassed.
- [ ] Docs updated.
- [ ] Initiative complete.

## Validation

Run targeted SSO integration, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, `svelte-check-native`, browser checks, and `git diff --check`. Record evidence before marking Complete.

## Known Limitations

Document any provider or plugin limitations demonstrated by implementation.

## Follow-Ups

Record trusted upstream MFA assurance, OAuth2-only providers, and audit history in the post-MVP roadmap after PM6 completion.

## Completion Notes

Pending implementation and validation.
