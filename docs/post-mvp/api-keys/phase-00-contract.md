# PM3.0 — API Key Contract

## Status

Complete

## Goal

Document first-class API-key security, storage, ownership, authentication transport, scopes, ABAC interaction, admin management, and hardening boundaries.

## Scope

- Create the [PM3 API-key initiative index](README.md) and five bounded phase records.
- Define key format/storage, one-time reveal, owner subjects, accepted resource auth modes, transport decision point, expiry/revocation/rotation, scopes, rate-limit metadata, and secret redaction.
- Define protected admin UI/API operations and dependency on admin 2FA.
- Link the initiative from the post-MVP roadmap, architecture, and documentation index.

## Out of Scope

Key generation, persistence, request middleware, resource changes, admin UI/API implementation, new dependencies, and current API behavior.

## Architecture Decisions

Better Auth remains the human authentication foundation. API keys become explicit Nestrum principals and never create browser sessions or impersonate users. Scope permission and ABAC permission are conjunctive. Secrets are random, hashed, one-time reveal, and never logged. Admin key management requires Better Auth, admin 2FA, `admin.access`, management ABAC, and same-origin checks.

## Implementation

Added the initiative index and PM3.0–PM3.5 phase records. PM3.0 is complete; PM3.1–PM3.5 remain Not Started. No auth, resource, admin, or runtime code changed.

## Public API

Documents planned resource `api.auth`, API-key subject shape, admin routes, key format, transport decision, scopes, and rate-limit configuration. No executable exports or behavior are added.

## Files / Packages Changed

New `docs/post-mvp/api-keys/` documents plus updates to `docs/post-mvp.md`, `docs/architecture.md`, and `docs/README.md`. No package changes.

## Tests

Documentation validation only: required files/sections, relative links, and whitespace. Runtime/security tests are deferred to implementation phases.

## Acceptance Criteria

- [x] Key format and storage documented.
- [x] Ownership and explicit API-key subject semantics documented.
- [x] Authentication transport decision point documented.
- [x] Scope and ABAC interaction documented.
- [x] Admin management/2FA boundary documented.
- [x] Phase records and roadmap links created.

## Validation

Verify all six records, local links, standard sections, and `git diff --check`. No runtime test is expected for this documentation-only phase.

## Known Limitations

No API keys are accepted by the current runtime. Canonical header, hash algorithm, persistence schema, rate-limit provider, and exact resource API shape require implementation decisions.

## Follow-Ups

[PM3.1](phase-01-storage.md) implements generation and secure storage. The PM2 admin 2FA initiative remains a prerequisite for protected key management.

## Completion Notes

PM3.0 documents the plan without changing current authentication behavior.
