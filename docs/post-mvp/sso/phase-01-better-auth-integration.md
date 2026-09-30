# PM6.1 — Better Auth SSO Plugin Integration

## Status

Complete

## Goal

Install `@better-auth/sso` and register it in Nestrum's framework-owned Better Auth subsystem.

## Scope

- Add the plugin dependency and register it in `createAuthInstance` when `auth.sso.enabled` is true.
- Include the SSO provider schema in the framework-owned prebaked auth contract (PostgreSQL and MongoDB) and protected auth models.
- Make the plugin's callback routes reachable through the allowlisted `/api/auth` forwarding, and add any SSO client integration required.
- Keep existing email/password, session, 2FA, admin, and API-key behavior unchanged.

## Out of Scope

Nestrum management API/UI, provider registry, provisioning policy, and domain verification UX.

## Architecture Decisions

Depends on [PM6.0](phase-00-contract.md). The contract test compares the prebaked models with Better Auth's own schema for the configured plugins so upgrades cannot drift. SSO is off unless enabled, and the existing endpoint allowlist stays deny-by-default: only the SSO sign-in and callback paths needed for OIDC and SAML are added. Callback origins remain restricted to trusted origins.

## Implementation

`@better-auth/sso` 1.7.6 is a dependency of `@nestrum/auth` and is registered in `createAuthInstance` when `auth.sso.enabled` is true (`defineAuth({ sso: { enabled: true } })`; unknown SSO options throw). The plugin's provider table joins the prebaked contract as `SsoProvider` (PostgreSQL and MongoDB), and `Session` gains nullable `authMethod` and `ssoProviderId`; both are in `AUTH_MODELS`/protected models. The plugin's registration endpoint is disabled (`providersLimit: 0`). `handle` forwards only `POST /sign-in/sso`, `GET /sso/discover` (Nestrum's own), `GET /sso/callback/:providerId`, `GET|POST /sso/saml2/sp/acs/:providerId` and `GET /sso/saml2/sp/metadata`; every other plugin route stays 404. The ACS path alone skips the origin check because the IdP posts cross-site; sign-in and every other path keep it. Session-creation hooks tag sessions created inside the two callbacks.

## Public API

`AuthConfig.sso` (`SsoConfig`), `Authentication.sso?`, `SsoProviders` and the SSO types in `@nestrum/core`, `AUTH_MODELS` now including `SsoProvider`, and the `/api/auth` SSO paths above.

## Files / Packages Changed

`packages/auth/{package.json,src/auth.ts,src/contracts/contracts.ts,src/adapter/prisma-adapter.ts,src/sso/{options,routes}.ts}`, `packages/core/src/auth/{sso,auth.types}.ts`, auth fixtures, decision 0017, architecture, roadmap, initiative index, and this record.

## Tests

`packages/auth/tests/two-factor.test.ts` keeps the prebaked contracts (including `SsoProvider` and the session columns) in step with Better Auth's own schema for both providers; `sso.test.ts` covers SSO absent unless enabled, the route allowlist (management endpoints 404), cross-origin refusal and untrusted redirect targets; the existing auth, role, API-key and 2FA suites pass unchanged.

## Acceptance Criteria

- [x] Plugin starts with Nestrum auth.
- [x] Framework owns the required auth schema.
- [x] Callback routes work.
- [x] Existing authentication remains functional.
- [x] Docs updated.

## Validation

Run auth tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, real Prisma contract emission for both providers, and `git diff --check`.

## Known Limitations

Existing applications must migrate the `SsoProvider` table and the two `Session` columns. The plugin's single-logout endpoints are not forwarded.

## Follow-Ups

[PM6.2](phase-02-provider-registry.md) adds the provider registry and secure persistence.

## Completion Notes

The contract is written out per provider and proven against the plugin's own tables rather than generated, matching the other Better Auth models.
