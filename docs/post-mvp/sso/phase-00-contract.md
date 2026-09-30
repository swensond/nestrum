# PM6.0 — SSO Contract

## Status

Complete

## Goal

Document the enterprise SSO architecture, responsibility boundary, provider identity rules, admin requirements, organization/domain mapping, secret handling, admin 2FA relationship, and ABAC actions.

## Scope

- Create the PM6 index and nine bounded phase records.
- Freeze the Better Auth/Nestrum responsibility boundary, OIDC and SAML requirements, provider identity rules, admin management requirements, organization/domain mapping, secret handling, the admin 2FA rule, and the ABAC actions.
- Link the initiative from the post-MVP roadmap, architecture, and documentation index.

## Out of Scope

Provider registry, plugin integration, OIDC, SAML, admin API/UI, provisioning, dependencies, and any runtime behavior.

## Architecture Decisions

Better Auth's official SSO plugin (`@better-auth/sso`) owns protocol correctness; Nestrum owns provider lifecycle, secure configuration, organization/domain mapping, provisioning policy, ABAC integration, diagnostics, and the admin experience. OIDC and SAML 2.0 are both required from the first release, and a prebuilt Svelte admin is mandatory. `SSO authentication != Nestrum admin 2FA assurance`, and IdP claims never become Nestrum authorization on their own.

## Implementation

Added the initiative index and PM6.0–PM6.8 records. PM6.0 is complete; PM6.1–PM6.8 are Not Started. No package, schema, route, or runtime code changed.

## Public API

Documents planned `auth.sso` configuration, the `SSOProvider` discriminated model, `/admin/auth/sso*` pages, `/__admin/auth/sso*` routes, and the `sso.*` ABAC actions. No executable behavior is added.

## Files / Packages Changed

New `docs/post-mvp/sso/` documents plus updates to `docs/post-mvp.md`, `docs/architecture.md`, and `docs/README.md`. No package changes.

## Tests

Documentation validation only: required files/sections, relative links, and whitespace.

## Acceptance Criteria

- [x] Architecture documented.
- [x] Both OIDC and SAML explicitly required.
- [x] Admin UI explicitly required.
- [x] Docs updated.

## Validation

Verify all ten records, local links, standard sections, and `git diff --check`.

## Known Limitations

SSO is not implemented. Exact schema, plugin option names, encryption facility, and response shapes require implementation decisions against the installed `@better-auth/sso` version.

## Follow-Ups

[PM6.1](phase-01-better-auth-integration.md) integrates the plugin. The remaining MVP atomic object-policy write gate stays independent.

## Completion Notes

PM6.0 records the plan without changing authentication or runtime behavior.
