# PM6.4 — SAML 2.0

## Status

Not Started

## Goal

Provide complete SAML 2.0 provider support through Better Auth, including SP-initiated and configured IdP-initiated login.

## Scope

- Preferred setup: display name, provider ID, organization, domains, and IdP metadata XML (or metadata URL where supported).
- Expose the Service Provider values enterprise IT needs: ACS URL, SP entity ID/issuer, and callback information, derived so administrators never build them by hand.
- Advanced options: manual IdP settings, attribute mappings, IdP-initiated callback destination, and other supported SAML options.
- Validate metadata: parsing, required IdP values, certificate structure, IdP entity ID derivation.
- Support SP-initiated login and Better Auth's IdP-initiated flow with a safe post-login destination.

## Out of Scope

OIDC, the admin API/UI, and provisioning policy.

## Architecture Decisions

Depends on [PM6.2](phase-02-provider-registry.md). Better Auth owns assertion validation and NameID identity. Post-login destinations must be trusted origins or valid relative URLs, so no open-redirect path exists. Metadata validation must never be presented as a successful login test. Diagnostics cover invalid metadata and certificates and never include raw assertions.

## Implementation

Planned SAML registration mapped onto the plugin, metadata validation, SP value derivation, and IdP-initiated destination policy.

## Public API

Planned `SAMLProvider` configuration, SP information, and validation result types.

## Files / Packages Changed

Planned auth package, tests with a SAML fixture IdP, architecture, initiative index, and this record.

## Tests

Cover registration, metadata parsing, malformed metadata, certificate errors, SP values, SP-initiated login, configured IdP-initiated login, and rejection of untrusted redirect destinations.

## Acceptance Criteria

- [ ] SAML registration works.
- [ ] Metadata parsing works.
- [ ] Malformed metadata fails clearly.
- [ ] SP values are exposed for copy/setup.
- [ ] SP-initiated login works.
- [ ] IdP-initiated login works when configured.
- [ ] Docs updated.

## Validation

Run SAML tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, and `git diff --check`.

## Known Limitations

SAML single logout and encrypted-assertion options depend on what the installed plugin supports and are documented at implementation time.

## Follow-Ups

[PM6.5](phase-05-admin-backend.md) adds the private admin API.

## Completion Notes

Pending implementation and validation.
