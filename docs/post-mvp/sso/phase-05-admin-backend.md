# PM6.5 — Private Admin Management API

## Status

Complete

## Goal

Create `/__admin/auth/sso/*` for protected provider management of both protocols.

## Scope

- Operations: list, read, create, update, enable, disable, delete, test, at `/__admin/auth/sso`, `/__admin/auth/sso/[providerId]`, and `.../test`, `.../enable`, `.../disable`.
- Require Better Auth session, admin 2FA, `admin.access`, a specific SSO ABAC action, and the same-origin policy.
- ABAC actions: `sso.read`, `sso.create`, `sso.update`, `sso.delete`, `sso.enable`, `sso.disable`, `sso.test`; default deny.
- Redact all secret values; emit audit events for created, updated, enabled, disabled, deleted, test attempted, and domain verification changed.

## Out of Scope

The Svelte admin UI and provisioning.

## Architecture Decisions

Depends on [PM6.3](phase-03-oidc.md) and [PM6.4](phase-04-saml.md). Follows the API-key and feature-flag admin pattern: routes sit behind the complete admin boundary, then each operation needs its own ABAC action. `roleBasedAdminPolicies()` grants them to `admin` only. Delete removes provider configuration only; it does not delete Better Auth users or unrelated sessions, and any Better Auth account cleanup is documented at implementation time.

## Implementation

`registerSsoRoutes` (`packages/admin/src/sso-routes.ts`) adds, only when SSO is enabled: `GET|POST /__admin/auth/sso`, `GET|PATCH|DELETE /__admin/auth/sso/:providerId`, `POST …/test`, `POST …/enable`, `POST …/disable`, `POST …/domain-verification`, `POST …/domain-verification/verify` and `GET /__admin/auth/sso/capabilities`. They sit behind the complete admin boundary (same origin, session, `admin.access`, 2FA) and then need the `sso` ABAC actions `read`, `create`, `update`, `delete`, `enable`, `disable`, `test` (domain verification needs `update`), which `roleBasedAdminPolicies()` grants to `admin` only; a missing policy denies. Bodies go to the registry, which validates strictly. Responses are `no-store` and carry no stored secret. The acting subject ID is recorded as `createdBy`/`updatedBy` and as the audit actor. Unknown routes and methods under the prefix are 404s; everything is absent when SSO is off.

## Public API

`SSO_IDENTITY`, `SSO_ACTIONS`, `SsoAction`, the routes above, `roleBasedAdminPolicies()` SSO policies.

## Files / Packages Changed

`packages/admin/src/{sso-routes,policies,router,index,security}.ts`, `packages/admin/tests/sso.test.ts`, and this record.

## Tests

Real Better Auth sessions and TOTP: anonymous, user, staff (every route denied, capabilities all false) and admin; cross-origin refusal; SSO off gives 404 and empty capabilities; OIDC lifecycle with secret non-disclosure and audit events carrying the actor; SAML lifecycle; invalid input and unknown routes.

## Acceptance Criteria

- [x] Every management endpoint protected.
- [x] Action-specific ABAC enforced.
- [x] OIDC and SAML manageable.
- [x] Secret values redacted.
- [x] Docs updated.

## Validation

Run admin tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, and `git diff --check`.

## Known Limitations

Deleting a provider does not clean up linked Better Auth accounts; they remain and simply cannot sign in through it.

## Follow-Ups

[PM6.6](phase-06-admin-ui.md) adds the prebuilt Svelte admin.

## Completion Notes

Follows the API-key and feature-flag admin pattern.
