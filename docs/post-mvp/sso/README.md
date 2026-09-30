# Nestrum Post-MVP Plan 06 — Enterprise SSO

## Status and navigation

This is the sixth post-MVP initiative. PM6.0 records the SSO contract; PM6.1–PM6.8 are Not Started. Nothing described here is implemented unless a phase records implementation evidence.

| Phase | Goal | Primary surface | Status |
| --- | --- | --- | --- |
| [PM6.0 — SSO Contract](phase-00-contract.md) | Document SSO contract | docs/core contracts | Complete |
| [PM6.1 — Better Auth SSO Plugin Integration](phase-01-better-auth-integration.md) | Better Auth SSO plugin integration | auth | Not Started |
| [PM6.2 — Provider Registry and Secure Persistence](phase-02-provider-registry.md) | Provider registry and secure persistence | auth/core | Not Started |
| [PM6.3 — OpenID Connect](phase-03-oidc.md) | OIDC | auth | Not Started |
| [PM6.4 — SAML 2.0](phase-04-saml.md) | SAML 2.0 | auth | Not Started |
| [PM6.5 — Private Admin Management API](phase-05-admin-backend.md) | Private admin management API | admin | Not Started |
| [PM6.6 — Prebuilt Svelte SSO Admin](phase-06-admin-ui.md) | Prebuilt Svelte SSO admin | admin-ui | Not Started |
| [PM6.7 — Provisioning, Organization and Domain Mapping](phase-07-provisioning.md) | Provisioning and organization/domain mapping | auth/admin | Not Started |
| [PM6.8 — SSO Hardening](phase-08-hardening.md) | Diagnostics, testing, hardening | integration/security | Not Started |

## Purpose

First-class enterprise Single Sign-On built on Better Auth's official SSO plugin (`@better-auth/sso`). **OpenID Connect and SAML 2.0 are both required from the first release**, and Nestrum ships a **prebuilt Svelte admin** for managing connections; API-only provider registration is not sufficient. OAuth2-only enterprise providers may be considered later.

Better Auth owns protocol correctness. Nestrum owns provider lifecycle, secure configuration, organization/domain mapping, provisioning policy, ABAC integration, diagnostics, and the admin experience. Consuming applications implement no protocol handlers (OIDC discovery, token exchange, JWKS validation, SAML assertions and callbacks), provider CRUD, secret handling, management pages, or organization/domain mapping.

## Target experience

```ts
export default defineConfig({
  auth: {
    database: "default",
    sso: { enabled: true },
  },
});
```

Administrators then manage providers at `/admin/auth/sso` and configure OIDC and SAML without application-owned UI. (The final configuration location follows the existing `defineAuth` pattern and is fixed in PM6.1.)

## Responsibility boundary

```text
Identity Provider -> Better Auth SSO plugin -> verified protocol identity
  -> Better Auth user/session -> Nestrum SubjectFactory -> Nestrum ABAC
```

| Better Auth handles | Nestrum handles |
| --- | --- |
| OIDC discovery, authorization/token flow, JWKS/token validation | Provider registry and lifecycle, ownership |
| SAML assertion validation, NameID identity | Secure secret persistence |
| SSO callback routes | Enable/disable state |
| Protocol-level provider configuration | Organization mapping, domain mapping/verification UX |
| | Provisioning rules, `resolveUser` integration |
| | SubjectFactory integration, admin API and UI, diagnostics/testing |

Nestrum wraps the plugin in Nestrum conventions rather than exposing Better Auth's raw provider APIs as the normal interface.

## Admin management (mandatory)

Pages: `/admin/auth/sso`, `/admin/auth/sso/new`, `/admin/auth/sso/[providerId]`. Private API: `/__admin/auth/sso`, `/__admin/auth/sso/[providerId]`, and `/test`, `/enable`, `/disable` beneath it. The admin supports list, create, edit, enable, disable, delete (with confirmation), test/validate, protocol type, organization, domains, verification state, diagnostics, last validation, and optionally last successful login.

Every operation requires: Better Auth session, `admin.access` ABAC, admin 2FA assurance, a specific SSO ABAC action, and the same-origin admin policy. Actions: `sso.read`, `sso.create`, `sso.update`, `sso.delete`, `sso.enable`, `sso.disable`, `sso.test`. Default deny applies.

## Provider model

```ts
type SSOProvider = OIDCProvider | SAMLProvider;
```

Common metadata: `id`, `providerId`, `displayName`, `type`, `enabled`, `organizationId?`, `domains`, `createdAt`, `updatedAt`, `createdBy?`, `updatedBy?`, `lastValidatedAt?`, `lastSuccessfulLoginAt?`. Provider IDs are unique, stable, URL-safe, and never collide with reserved Better Auth/social provider IDs; renaming the display name never changes `providerId`. Multiple providers coexist (for example Acme → Okta OIDC, Globex → Entra OIDC, Initech → SAML), and one organization may own several. The admin is built around a provider registry, not a single global form.

## OIDC

Required: display name, provider ID, organization, domains, issuer, client ID, client secret, enabled. Better Auth OIDC discovery resolves endpoints by default. Advanced section: scopes, PKCE, discovery/authorization/token/JWKS endpoint overrides, token endpoint authentication, profile mapping, extra claim mapping.

## SAML 2.0

Preferred setup: display name, provider ID, organization, domains, IdP metadata XML or URL where supported. The admin displays the Service Provider values enterprise IT needs (ACS URL, SP entity ID/issuer, callback information) so administrators never derive them. Advanced: manual IdP settings, attribute mappings, IdP-initiated callback destination. Better Auth's IdP-initiated flow is supported with a configured safe post-login destination; every redirect target must be a trusted origin or valid relative URL, never an open redirect.

## Secrets

Sensitive provider configuration (OIDC client secrets and other private values) is encrypted at rest with Nestrum's framework crypto facilities, never returned by admin APIs (`"clientSecretConfigured": true`, not the secret), never displayed by the UI, unchanged on edit unless explicitly replaced, and redacted from logs and diagnostics.

## Storage

The Better Auth SSO provider schema joins the framework-owned prebaked auth contract. Nestrum-specific state (display name, enabled, validation timestamps, operational status) uses Better Auth-supported provider fields or adjacent framework metadata, avoiding a duplicate provider database.

## Organizations and domains

Providers may belong to a Better Auth/Nestrum organization; where Better Auth's organization plugin provides native integration it is used rather than duplicated. Each provider may own one or more domains, used for discovery, sign-in routing, trusted account linking, and organization assignment. A configured domain is not trusted merely because it was entered: where Better Auth domain verification is enabled, the admin shows verified, unverified or pending, and account linking and automatic organization assignment follow verified semantics.

## Login discovery

A user enters an email, the domain is extracted, the enabled matching provider is resolved, and Better Auth's SSO redirect begins. Selection also supports provider ID, organization slug, domain, and login hint. Multiple matches produce an explicit choice, never an arbitrary pick.

## Enable, disable, delete

Disabling (the normal operational action) blocks new sign-ins without deleting the provider or touching users and sessions. Deleting is destructive and requires confirmation: it removes provider configuration and does not delete Better Auth users or unrelated sessions; any Better Auth account cleanup is documented at implementation time.

## Validation

Test/validate is distinct from a verified login. OIDC: discovery fetch, issuer validation, required endpoints, configuration completeness. SAML: metadata parsing, required IdP values, certificate structure, IdP entity ID derivation. A metadata validation is never presented as a successful interactive login.

## Provisioning, resolution and attributes

Better Auth provisioning is exposed through Nestrum: implicit signup on/off, provision new users, optionally provision/update on each login, custom provisioning callback, organization membership provisioning, default role, custom role resolver. `resolveUser` is an extension point (legacy account mapping, employee ID matching, controlled linking) relying only on protocol-verified claims. External attributes (email, name, image, department, employee ID, role hints) map into application/profile data only through explicit configuration.

**IdP attributes never become Nestrum authorization.** An IdP claim `role=admin` cannot bypass `admin.access` or any ABAC policy.

## SubjectFactory and admin 2FA

After SSO the Better Auth session flows through the Nestrum SubjectFactory to ABAC; trusted context includes `authMethod = "sso"` and `ssoProviderId`, plus explicitly mapped attributes. Initial rule: `SSO authentication != Nestrum admin 2FA assurance`. An SSO login reaches `admin.access` and then the Nestrum second-factor challenge. Trusting upstream MFA (`acr`/`amr`, SAML `AuthnContext`) is a future enhancement and is never inferred automatically.

## Audit, diagnostics and logging

An audit/event seam covers provider created, updated, enabled, disabled, deleted, test attempted, and domain verification changed. Diagnostics name common failures (OIDC discovery failed, issuer mismatch, provider ID collision, missing client secret, invalid SAML metadata, invalid certificate, domain unverified, callback origin untrusted, organization missing, provider disabled) without raw tokens or assertions. Safe log fields: provider ID, protocol, organization ID, error category, request ID, trace ID. Never logged: client secrets, access/refresh/ID tokens, raw SAML assertions, private keys, sensitive metadata.

## Testing

Vitest: provider registry and ID collisions, enable/disable, OIDC configuration and discovery failure, SAML configuration and malformed metadata, organization and domain association, secret encryption and redaction, SSO management ABAC, admin 2FA enforcement, provisioning configuration, SubjectFactory SSO context. Integration fixtures cover both OIDC and SAML; Playwright covers the admin lifecycle for both protocols.

## Definition of done

- [ ] Nestrum uses Better Auth's official SSO plugin.
- [ ] OIDC and SAML 2.0 are supported from the first release.
- [ ] Multiple providers coexist and attach to organizations with one or more domains.
- [ ] Sensitive provider data is encrypted and redacted.
- [ ] OIDC discovery and SAML IdP metadata are supported; SAML SP values are shown in admin.
- [ ] SP-initiated and configured IdP-initiated SAML work.
- [ ] Providers can be tested/validated and enabled/disabled.
- [ ] Nestrum ships a complete Svelte admin for provider management.
- [ ] SSO management requires admin 2FA and ABAC.
- [ ] SSO users pass through SubjectFactory and ABAC; external claims cannot bypass Nestrum authorization.
- [ ] Better Auth provisioning and `resolveUser` are exposed through Nestrum.
- [ ] Applications need no SSO protocol handlers or custom management UI.
- [ ] Documentation reflects the implementation.

Every phase updates documentation and leaves the repository green. See [architecture](../../architecture.md), [post-MVP roadmap](../../post-mvp.md), and [phase requirements](../../phases/README.md#completion-requirements).
