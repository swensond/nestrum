# PM6.3 — OpenID Connect

## Status

Not Started

## Goal

Provide complete OIDC provider support through Better Auth.

## Scope

- Minimum configuration: display name, provider ID, organization, domains, issuer, client ID, client secret, enabled; rely on Better Auth OIDC discovery by default.
- Advanced overrides: scopes, PKCE, discovery/authorization/token/JWKS endpoint overrides, token endpoint authentication, profile mapping, and extra claim mapping.
- Test/validate: fetch the discovery document, validate the issuer, check required endpoints and configuration completeness, with understandable errors.
- SSO sign-in that produces a Better Auth session which the Nestrum SubjectFactory maps to an ABAC subject.

## Out of Scope

SAML, the admin API/UI, and provisioning policy.

## Architecture Decisions

Depends on [PM6.2](phase-02-provider-registry.md). Better Auth owns discovery, the authorization/token flow, and JWKS/token validation. Validation proves configuration is well-formed; it is never presented as a successful interactive login. Diagnostics distinguish discovery failure, issuer mismatch, missing client secret, and provider ID collision without exposing tokens.

## Implementation

Planned OIDC registration and update mapped onto the plugin, validation service, and sign-in wiring.

## Public API

Planned `OIDCProvider` configuration and validation result types.

## Files / Packages Changed

Planned auth package, tests with an OIDC fixture IdP, architecture, initiative index, and this record.

## Tests

Cover registration, discovery success and failure, issuer mismatch, advanced overrides, secret protection, sign-in to a Better Auth session, and SubjectFactory receiving that session.

## Acceptance Criteria

- [ ] Provider registration works.
- [ ] Discovery works.
- [ ] Discovery errors are understandable.
- [ ] Sign-in produces a Better Auth session.
- [ ] Nestrum SubjectFactory receives the session.
- [ ] Secret protected.
- [ ] Docs updated.

## Validation

Run OIDC tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, and `git diff --check`.

## Known Limitations

OAuth2-only enterprise providers are out of scope.

## Follow-Ups

[PM6.4](phase-04-saml.md) adds SAML 2.0.

## Completion Notes

Pending implementation and validation.
