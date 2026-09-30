# PM6.6 — Prebuilt Svelte SSO Admin

## Status

Complete

## Goal

Ship the built-in admin experience so applications need no custom SSO UI.

## Scope

- Pages: `/admin/auth/sso` (provider list), `/admin/auth/sso/new`, `/admin/auth/sso/[providerId]`.
- List columns: display name, provider ID, protocol, organization, domains, enabled/disabled, domain verification, last validation, last successful login; actions Edit, Test, Enable, Disable, Delete.
- OIDC form (display name, provider ID, organization, domains, issuer, client ID, client secret, enabled) with an advanced section (scopes, PKCE, endpoint overrides, profile and extra claim mappings).
- SAML form (display name, provider ID, organization, domains, IdP metadata, enabled) with a copy-friendly Service Provider section (ACS URL, SP entity ID, callback values) and advanced options.
- Validation/test result panel, delete confirmation, organization selector, and domain verification status. Stored secrets are never redisplayed.

## Out of Scope

Provisioning policy and application-owned pages.

## Architecture Decisions

Depends on [PM6.5](phase-05-admin-backend.md). Follows the existing admin-ui server-module pattern: native forms, fixed safe error messages, no echoed response bodies, and controls shown only when the API grants the capability. The UI states clearly that a passing test validates configuration and is not a verified login.

## Implementation

`packages/admin-ui` adds `/admin/auth/sso` (list with name, ID, protocol, organization, domains, status, domain verification, last validation and last sign-in, plus Edit, Test, Enable/Disable and Delete), `/admin/auth/sso/new` (OIDC or SAML form chosen by `?type=`, advanced sections in native `<details>`) and `/admin/auth/sso/[providerId]` (settings, the redirect URI or SAML service-provider values, test panel, domain-verification DNS record, typed-ID delete confirmation). A server module (`sso.server.ts`) validates every payload with zod, allowlists form fields, maps failures to fixed safe messages, and never echoes response bodies. Controls appear only when the capability is granted, secrets render only as "Configured — leave blank to keep", and the test panel states that a passing test is not a sign-in. The shell adds a "Single sign-on" link for subjects who can read. `/admin/auth/sso*` is an ordinary page, not one of the challenge pages under `/admin/auth`.

## Public API

`SsoAdminClient`, page data loaders and form actions, layout `canManageSso`.

## Files / Packages Changed

`packages/admin-ui/src/lib/{sso.server.ts,return-to.ts,AdminShell.svelte}`, `packages/admin-ui/src/routes/auth/sso/**`, layout, tests, and this record.

## Tests

`packages/admin-ui/tests/sso.test.ts`: client credentialing and payload validation, fixed messages, loaders for off/denied/ready, exact request bodies (including the write-only secret and omitted blank secret), forged-field rejection, toggle/test/verify/delete, typed delete confirmation, and page rendering with and without capabilities. `svelte-check-native` and the prebuilt-admin verification pass. `apps/example/tooling/sso-admin-browser.mjs` drives the lifecycle in Chromium.

## Acceptance Criteria

- [x] OIDC can be fully configured in admin.
- [x] SAML can be fully configured in admin.
- [x] Application needs no custom Svelte.
- [x] Secrets never redisplayed.
- [x] Test action available.
- [x] `svelte-check-native` passes.
- [x] Docs updated.

## Validation

Run admin-ui tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, `svelte-check-native`, and `git diff --check`.

## Known Limitations

Forms use native submission, so pages reload on each action. The organization field is a free-text identifier rather than a selector because Nestrum has no organization registry.

## Follow-Ups

[PM6.7](phase-07-provisioning.md) adds provisioning and mapping.

## Completion Notes

The application writes no SSO pages.
