# PM6.5 — Private Admin Management API

## Status

Not Started

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

Planned admin routes, ABAC policies, redacting serializers, audit event seam, and safe diagnostics.

## Public API

Planned routes, `sso.*` actions, provider request/response shapes, and the audit event shape.

## Files / Packages Changed

Planned admin package, tests, architecture, initiative index, and this record.

## Tests

Cover 2FA, per-action ABAC, same-origin, OIDC and SAML CRUD, enable/disable, delete, test, redaction, invalid input, and audit events.

## Acceptance Criteria

- [ ] Every management endpoint protected.
- [ ] Action-specific ABAC enforced.
- [ ] OIDC and SAML manageable.
- [ ] Secret values redacted.
- [ ] Docs updated.

## Validation

Run admin tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, and `git diff --check`.

## Known Limitations

No UI yet.

## Follow-Ups

[PM6.6](phase-06-admin-ui.md) adds the prebuilt Svelte admin.

## Completion Notes

Pending implementation and validation.
