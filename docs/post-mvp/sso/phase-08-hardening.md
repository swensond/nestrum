# PM6.8 — SSO Hardening

## Status

Complete

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

Diagnostics are fixed-text categories returned by `test` and stored as last-validation time and status: OIDC discovery failed, issuer mismatch, endpoint missing, client secret missing, invalid SAML metadata, invalid certificate, IdP values missing, domain unverified, callback origin untrusted and provider disabled (`ORGANIZATION_MISSING` is declared but unused because organizations are opaque). The registry and routes log nothing; tests capture console output across sign-in and prove that client secrets, tokens and assertions do not appear there or in responses, audit events or stored rows. Audit events are verified for create, update, enable, disable, delete, test and domain verification. Disabled providers reject sign-in, callback, ACS and metadata; an SSO session never satisfies admin 2FA. Delete removes configuration only.

## Public API

No new API; documents the demonstrated behavior.

## Files / Packages Changed

Tests and tooling (`sso-postgres.mjs`, `sso-admin-browser.mjs`, `fixtures/idp-metadata.xml`), example opt-in and README, architecture, roadmap, decision 0017, all PM6 records.

## Tests

Full repository suite (`pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `verify:build`). `pnpm --filter @nestrum/example verify:sso` passes on a real PostgreSQL 16 (sealing at rest, concurrent creation, full OIDC sign-in, disable, delete). `pnpm --filter @nestrum/example e2e:sso` passes in Chromium: OIDC and SAML admin lifecycles, the secret never rendered, typed delete confirmation, a browser OIDC sign-in producing an ordinary user, and that user unable to see provider configuration.

## Acceptance Criteria

- [x] OIDC admin workflow E2E passes.
- [x] SAML admin workflow E2E passes.
- [x] Disabled providers reject new SSO login.
- [x] Sensitive material never logged.
- [x] Admin 2FA cannot be bypassed.
- [x] Docs updated.
- [x] Initiative complete.

## Validation

Run targeted SSO integration, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, `svelte-check-native`, browser checks, and `git diff --check`. Record evidence before marking Complete.

## Known Limitations

The Docker + MongoDB `pnpm test:integration` run with SSO enabled in the example was run by the project owner and passes. SAML sign-ins use signed fixtures, not a live IdP. Single logout, `private_key_jwt`, upstream-MFA trust, organization-plugin integration, a non-password admin assurance path for SSO-only administrators and audit history remain future work.

## Follow-Ups

Record trusted upstream MFA assurance, OAuth2-only providers, and audit history in the post-MVP roadmap after PM6 completion.

## Completion Notes

PM6 is complete with the limitations above and in decision 0017.
