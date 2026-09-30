# PM6.7 — Provisioning, Organization and Domain Mapping

## Status

Not Started

## Goal

Expose Better Auth provisioning capabilities through Nestrum configuration with safe identity and attribute handling.

## Scope

- Policy: implicit signup enabled/disabled, provision new users, optionally provision/update on every SSO login, custom provisioning callback.
- Organization membership provisioning, default role, and a custom role resolver, using Better Auth's organization plugin where it provides native integration.
- Expose Better Auth `resolveUser` as an extension point (legacy account mapping, employee ID matching, controlled linking) relying only on protocol-verified claims.
- Domain verification status (verified, unverified, pending) surfaced from Better Auth; account linking and automatic organization assignment follow trusted/verified semantics only.
- Login discovery by email domain, provider ID, organization slug, or login hint, with an explicit choice when several providers match.
- Trusted attribute mapping (email, name, image, department, employee ID, role hints) and SubjectFactory context: `authMethod = "sso"`, `ssoProviderId`, plus explicitly configured attributes.

## Out of Scope

Trusting upstream MFA assurance (`acr`/`amr`, `AuthnContext`) for admin 2FA.

## Architecture Decisions

Depends on [PM6.6](phase-06-admin-ui.md). IdP attributes never become Nestrum authorization on their own: an IdP claim `role=admin` cannot bypass `admin.access` or any ABAC policy, and external attributes reach subjects or provisioning only through explicit mapping. `SSO authentication != Nestrum admin 2FA assurance`: an SSO login still reaches `admin.access` and then the Nestrum second-factor challenge.

## Implementation

Planned provisioning configuration, resolver hooks, discovery endpoint, domain trust rules, and SubjectFactory integration.

## Public API

Planned provisioning options, `resolveUser`, role resolver, discovery flow, and subject attributes.

## Files / Packages Changed

Planned auth/admin/admin-ui packages, tests, architecture, initiative index, and this record.

## Tests

Cover new-user provisioning, disabled signup, safe resolution of existing users, organization provisioning, role resolver, unverified-domain refusal, multi-provider discovery choice, IdP role claims granting nothing, SSO subject context, and admin 2FA still required after SSO.

## Acceptance Criteria

- [ ] New SSO users can be provisioned.
- [ ] Signup can be disabled.
- [ ] Existing users can be safely resolved.
- [ ] Organization provisioning works.
- [ ] IdP role claims do not directly grant Nestrum privilege.
- [ ] Docs updated.

## Validation

Run provisioning/auth tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, and `git diff --check`.

## Known Limitations

Trusting upstream MFA is future work.

## Follow-Ups

[PM6.8](phase-08-hardening.md) hardens and verifies end to end.

## Completion Notes

Pending implementation and validation.
