# PM6.6 — Prebuilt Svelte SSO Admin

## Status

Not Started

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

Planned SvelteKit routes, server modules, shell navigation, and component tests.

## Public API

Planned admin routes and layout capability flag.

## Files / Packages Changed

Planned `packages/admin-ui`, tests, architecture, initiative index, and this record.

## Tests

Cover list, both forms, secret non-redisplay, unchanged-secret edit, SP value rendering, test panel, enable/disable, delete confirmation, permissions, and `svelte-check-native`.

## Acceptance Criteria

- [ ] OIDC can be fully configured in admin.
- [ ] SAML can be fully configured in admin.
- [ ] Application needs no custom Svelte.
- [ ] Secrets never redisplayed.
- [ ] Test action available.
- [ ] `svelte-check-native` passes.
- [ ] Docs updated.

## Validation

Run admin-ui tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, `svelte-check-native`, and `git diff --check`.

## Known Limitations

Playwright lifecycle coverage lands in PM6.8.

## Follow-Ups

[PM6.7](phase-07-provisioning.md) adds provisioning and mapping.

## Completion Notes

Pending implementation and validation.
