# PM6.4 — SAML 2.0

## Status

Complete

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

SAML providers are set up from IdP metadata XML (preferred) or a manual SSO URL plus signing certificate. The SP entity ID (`<base>/api/auth/sso/saml2/sp/metadata?providerId=…`), ACS URL, metadata URL and callback are derived and returned for display. Validation parses the metadata with the plugin (`deriveSAMLIdentityProviderEntityID`), checks that signing certificates parse and have not expired, and reports `SAML_METADATA_INVALID`, `SAML_CERTIFICATE_INVALID` or `SAML_IDP_VALUES_MISSING`; invalid SAML is rejected on create and edit. Assertions are required to be signed by default. SP-initiated login uses the plugin's AuthnRequest/InResponseTo tracking. IdP-initiated login needs both `sso.saml.allowIdpInitiated` and a provider `idpInitiatedCallbackUrl` (a same-site path or an absolute URL; other origins must be trusted origins); unsolicited responses are recognized before the plugin runs and refused with `SAML_IDP_INITIATED_DISABLED` otherwise, and the plugin still validates the response and never redirects to an untrusted RelayState.

## Public API

`SsoSamlInput`, `SsoSamlAdvanced`, `SsoSamlSummary` with `serviceProvider` (`acsUrl`, `entityId`, `metadataUrl`, `callbackUrl`) and `idpEntityId`, `sso.saml.allowIdpInitiated`, `POST /api/auth/sso/saml2/sp/acs/:providerId`, `GET /api/auth/sso/saml2/sp/metadata`.

## Files / Packages Changed

`packages/auth/src/sso/{service,routes,options}.ts`, `packages/auth/tests/{sso,sso-saml}.test.ts` and fixtures (a long-lived test certificate), and this record.

## Tests

`sso-saml.test.ts` signs real SAML responses with samlify: SP-initiated sign-in creating a tagged session (and refusing a replay), IdP-initiated sign-in landing on the configured destination, refusal when the operator flag or destination is missing, untrusted RelayState ignored, altered and unsigned responses rejected with no user or session. `sso.test.ts`: SP values, malformed metadata, bad and expired certificates, manual settings, destination validation, metadata hidden and ACS refused for disabled providers. The admin browser check creates a SAML provider from pasted metadata.

## Acceptance Criteria

- [x] SAML registration works.
- [x] Metadata parsing works.
- [x] Malformed metadata fails clearly.
- [x] SP values are exposed for copy/setup.
- [x] SP-initiated login works.
- [x] IdP-initiated login works when configured.
- [x] Docs updated.

## Validation

Run SAML tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, and `git diff --check`.

## Known Limitations

Single logout is not forwarded. Encrypted assertions and request signing are not configurable in the admin. Interactive SAML logins against a real IdP were not run; the fixtures sign responses with a test key.

## Follow-Ups

[PM6.5](phase-05-admin-backend.md) adds the private admin API.

## Completion Notes

Assertion validation and NameID identity stay with Better Auth.
