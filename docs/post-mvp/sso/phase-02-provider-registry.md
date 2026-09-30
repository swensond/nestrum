# PM6.2 — Provider Registry and Secure Persistence

## Status

Complete

## Goal

Implement Nestrum's SSO provider abstraction with secure persistence, organization and domain association, and enable/disable state.

## Scope

- Define the `SSOProvider = OIDCProvider | SAMLProvider` discriminated model with common metadata: id, providerId, displayName, type, enabled, organizationId?, domains, createdAt, updatedAt, createdBy?, updatedBy?, lastValidatedAt?, lastSuccessfulLoginAt?.
- Enforce unique, stable, URL-safe provider IDs that do not collide with reserved Better Auth/social provider IDs; display name changes never change `providerId`.
- Encrypt sensitive configuration at rest with Nestrum's framework crypto facilities and never return stored secrets (`clientSecretConfigured: true` instead).
- Persist Nestrum-specific state (display name, enabled, validation timestamps, operational status) in Better Auth-supported provider fields or adjacent framework metadata rather than a duplicate provider database.
- Support multiple concurrent providers and one organization owning several.

## Out of Scope

Protocol specifics (PM6.3/PM6.4), the admin API/UI, and provisioning.

## Architecture Decisions

Depends on [PM6.1](phase-01-better-auth-integration.md). Disabling is the normal operational action and prevents new sign-ins without deleting the provider, users, or sessions. Secrets are write-only: an edit may leave a secret unchanged or explicitly replace it. Secrets are redacted from logs and diagnostics.

## Implementation

`SsoRegistry` (`packages/auth/src/sso/service.ts`) implements `SsoProviders` over the plugin's `ssoProvider` table. Nestrum state lives in the plugin's `additionalFields` on that table (`displayName`, `enabled`, `createdBy`, `updatedBy`, `lastValidatedAt`, `lastValidationStatus`, `lastSuccessfulLoginAt`, `createdAt`, `updatedAt`), so there is no second provider database. Inputs are validated strictly (zod, unknown keys rejected); provider IDs are 3–48 characters of lowercase letters, digits and hyphens, unique, permanent and never a reserved Better Auth or social ID; domains are normalized DNS names and several providers may share a domain or organization. OIDC client secrets and SAML private keys are sealed with AES-256-GCM (HKDF from the auth secret, `nsso1:` envelope) in the auth database adapter, so the plugin sees plaintext and the table never stores it. Summaries carry `clientSecretConfigured`, never a secret. Edits keep the stored secret unless a replacement is supplied. Disabling is an update; `delete` removes the provider row and its pending verification record only. An `onAudit` seam receives created/updated/enabled/disabled/deleted/test-attempted/domain-verification-changed events with the actor and changed setting names.

## Public API

`application.auth.sso`: `list`, `get`, `create`, `update`, `setEnabled`, `delete`, `test`, `discover`, `requestDomainVerification`, `verifyDomain`; `SsoError` and its codes; `sso.onAudit`.

## Files / Packages Changed

`packages/auth/src/sso/{service,secrets}.ts`, `packages/auth/src/adapter/prisma-adapter.ts` (row codec), `packages/core/src/auth/sso.ts`, tests, decision 0017, and this record.

## Tests

`packages/auth/tests/sso.test.ts` and `sso-units.test.ts`: creation, secret encryption at rest and non-disclosure, unchanged secret on edit, ID collision/reserved/malformed rejection and ID stability, several providers and organizations, private-host refusal, disabling without deletion, delete semantics (users, accounts, sessions kept), audit events, sealing round trips, tamper and wrong-key detection, SAML private-value sealing. `sso-postgres.mjs` repeats the essentials on real PostgreSQL, including a concurrent-creation race.

## Acceptance Criteria

- [x] Multiple providers supported.
- [x] IDs are unique.
- [x] Secrets cannot be read back.
- [x] Provider can be disabled without deletion.
- [x] Docs updated.

## Validation

Run registry/persistence tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, and `git diff --check`.

## Known Limitations

Rotating the auth secret makes stored provider secrets unreadable (`SSO_SECRET_UNREADABLE`) until re-entered. `organizationId` is an opaque application identifier; Nestrum does not validate it.

## Follow-Ups

[PM6.3](phase-03-oidc.md) adds OIDC.

## Completion Notes

The registry is the only writer; the plugin's own registration and management endpoints are never reachable.
