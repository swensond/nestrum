# PM6.3 — OpenID Connect

## Status

Complete

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

OIDC providers take display name, provider ID, organization, domains, issuer, client ID, client secret and enabled, with an advanced block (scopes, PKCE default on, discovery/authorization/token/JWKS/userinfo overrides, token-endpoint authentication, profile mapping). Saving an enabled provider runs the plugin's own `discoverOIDCConfig` and stores the hydrated endpoints; a disabled provider is stored without network access and validated when enabled. `test` and enablement return fixed diagnostics: `OIDC_DISCOVERY_FAILED`, `OIDC_ISSUER_MISMATCH`, `OIDC_ENDPOINT_MISSING`, `CALLBACK_ORIGIN_UNTRUSTED`, `OIDC_CLIENT_SECRET_MISSING`; remote bodies and URLs are never echoed. IdP URLs must be public HTTPS (hosts are resolved, so a public name pointing at a private address is refused) unless declared in `sso.trustedIdpOrigins`; origins of enabled providers are added to Better Auth's dynamic trusted origins, which the plugin requires before fetching them. Sign-in resolves an enabled provider, forwards an allowlisted body (client scopes and extra authorization parameters dropped) and the callback yields a Better Auth session tagged `authMethod: 'sso'` with the provider ID, which the SubjectFactory exposes to ABAC.

## Public API

`SsoOidcInput`, `SsoOidcAdvanced`, `SsoOidcSummary` (with `redirectUri`), `SsoTestResult`/`SsoDiagnostic`, `sso.trustedIdpOrigins`, `POST /api/auth/sign-in/sso`, `GET /api/auth/sso/callback/:providerId`.

## Files / Packages Changed

`packages/auth/src/sso/{service,network,routes}.ts`, `packages/auth/tests/{sso,sso-units}.test.ts` and `sso-fixtures.ts` (a local OpenID provider), `apps/example/tooling/sso-postgres.mjs`, and this record.

## Tests

Against a real local OIDC provider: create and hydrate, discovery failure and issuer mismatch, refusal to enable or create an enabled provider that fails discovery, a full authorization-code sign-in producing a session with `authMethod`/`ssoProviderId` and subject context, scope injection dropped, untrusted redirect targets refused, IdP claims unable to set a role, network-policy unit tests.

## Acceptance Criteria

- [x] Provider registration works.
- [x] Discovery works.
- [x] Discovery errors are understandable.
- [x] Sign-in produces a Better Auth session.
- [x] Nestrum SubjectFactory receives the session.
- [x] Secret protected.
- [x] Docs updated.

## Validation

Run OIDC tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, and `git diff --check`.

## Known Limitations

`private_key_jwt` authentication and OAuth2-only providers are not offered. Validation proves configuration is well-formed; it is never a login.

## Follow-Ups

[PM6.4](phase-04-saml.md) adds SAML 2.0.

## Completion Notes

Discovery and token validation are the plugin's; Nestrum adds origin policy, sealing and fixed diagnostics.
