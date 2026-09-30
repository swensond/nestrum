# PM6.2 — Provider Registry and Secure Persistence

## Status

Not Started

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

Planned registry service, provider validation, encryption of sensitive fields, redacting serializers, and audit event emission.

## Public API

Planned `SSOProvider` types, registry service on `application.auth`, and the redacted provider representation.

## Files / Packages Changed

Planned auth/core packages, contracts if adjacent metadata is needed, tests, architecture, initiative index, and this record.

## Tests

Cover provider ID validation and collisions, immutable IDs, multiple providers, enable/disable, encryption at rest, redaction of every read path, unchanged-secret edits, and organization/domain association.

## Acceptance Criteria

- [ ] Multiple providers supported.
- [ ] IDs are unique.
- [ ] Secrets cannot be read back.
- [ ] Provider can be disabled without deletion.
- [ ] Docs updated.

## Validation

Run registry/persistence tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, and `git diff --check`.

## Known Limitations

No protocol-specific configuration or management surface yet.

## Follow-Ups

[PM6.3](phase-03-oidc.md) adds OIDC.

## Completion Notes

Pending implementation and validation.
