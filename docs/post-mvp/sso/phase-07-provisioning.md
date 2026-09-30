# PM6.7 — Provisioning, Organization and Domain Mapping

## Status

Complete

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

`sso.provisioning` passes Better Auth's `disableImplicitSignUp`, `provisionUser`, `provisionUserOnEveryLogin`, `organizationProvisioning`, `resolveUser` and `trustEmailVerified` to the plugin unchanged. New SSO users are created with the ordinary `user` role; `provisionUser` runs for them and, with `provisionUserOnEveryLogin`, on every login. `disableImplicitSignUp` blocks creating users (a sign-in may still request sign-up explicitly). Login discovery (`GET /api/auth/sso/discover`, `discover()`) resolves an enabled provider by email domain, `domain`, `providerId` or `organizationSlug` (via `sso.resolveOrganization`), returns an explicit choice when several match and only routes verified domains when domain verification is on. Domain verification is opt-in: the admin requests a DNS TXT record (`_nestrum-sso-<providerId>.<domain>`) and verifies it; changing domains resets trust; status is verified, pending, unverified or not-required. The default SubjectFactory adds `authMethod: 'sso'` and `ssoProviderId` to SSO subjects, and attribute mapping to profile fields is explicit per provider. `sessionAssurance` treats any SSO session as lacking the second factor.

## Public API

`SsoConfig.provisioning`, `resolveOrganization`, `domainVerification`, `SsoDiscoveryResult`, `SsoDomainVerificationInstructions`, the SSO subject attributes.

## Files / Packages Changed

`packages/auth/src/sso/{options,service,routes}.ts`, `packages/auth/src/session/subject-factory.ts`, `packages/admin/src/security.ts`, tests, and this record.

## Tests

Provisioning (callback, disabled sign-up, explicit sign-up, role stays `user`), resolveUser fail-closed behavior, discovery by domain/ID/organization with explicit choice over the API, domain verification through unverified, pending and verified with a DNS fake and reset on domain change, sign-in blocked while unverified, the SSO subject context, and admin tests proving an SSO session (enrolled or not, even promoted to admin) still gets `ADMIN_2FA_REQUIRED`.

## Acceptance Criteria

- [x] New SSO users can be provisioned.
- [x] Signup can be disabled.
- [ ] Existing users can be safely resolved. (`resolveUser` is exposed but fails closed until the auth adapter has native transactions; see Known Limitations.)
- [ ] Organization provisioning works. (Options pass through, but Nestrum does not install Better Auth's organization plugin, so it is inactive.)
- [x] IdP role claims do not directly grant Nestrum privilege.
- [x] Docs updated.

## Validation

Run provisioning/auth tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, and `git diff --check`.

## Known Limitations

`resolveUser` is wired but the plugin runs it inside a native database transaction, which Nestrum's Prisma adapter does not provide, so it currently fails closed with `SSO_USER_RESOLUTION_REQUIRES_NATIVE_TRANSACTIONS` and creates no user or session. Nestrum does not install Better Auth's organization plugin, so organization membership provisioning and domain-based organization assignment are not active (`organizationId` is an opaque identifier). An SSO-only administrator cannot complete the password-based second factor and so cannot reach admin.

## Follow-Ups

[PM6.8](phase-08-hardening.md) hardens and verifies end to end.

## Completion Notes

Upstream MFA assurance is deliberately not trusted.
