# PM3.2 — Request Authentication

## Status

Not Started

## Goal

Authenticate API-key requests and create explicit API-key subjects without creating Better Auth browser sessions.

## Scope

- Choose and document the canonical header/transport.
- Extract and verify keys, expiration, revocation, and ownership.
- Build API-key principals and map them through `SubjectFactory`.
- Allow resource APIs to opt into `api-key` authentication alongside `session`.
- Return safe authentication failures and integrate request context.

## Out of Scope

Scope/ABAC conjunction, admin key management, rate-limit enforcement, rotation hardening, and WebSocket/non-HTTP transports.

## Architecture Decisions

Depends on [PM3.1](phase-01-storage.md). API-key authentication is a distinct principal path. Never exchange credentials for Better Auth sessions or claim a human subject. Invalid, expired, and revoked keys fail immediately; errors never echo input. Preserve existing anonymous/session behavior for resources that do not opt into API keys.

## Implementation

Planned request extractor/verifier and subject context. Add explicit resource auth-mode validation; initial modes are `session` and `api-key`. Ensure the verifier runs before scope and resource ABAC checks, while preserving existing Hono/InferDI ownership.

## Public API

Planned resource `api.auth` values, canonical API-key header, API-key subject shape, and authentication error contract. Document exact HTTP statuses and precedence after implementation.

## Files / Packages Changed

Planned Hono/auth/core resource pipeline, tests, [architecture](../../architecture.md), [initiative index](README.md), and this record.

## Tests

Cover valid key, invalid key, expired/revoked key, subject owner mapping, resource opt-in/opt-out, no Better Auth browser session creation, session compatibility, and redacted failures.

## Acceptance Criteria

- [ ] Valid key authenticates.
- [ ] Invalid/revoked/expired key fails.
- [ ] API-key subject is created.
- [ ] No Better Auth browser session is created.
- [ ] Resource can opt into API-key auth.
- [ ] Docs updated.

## Validation

Run targeted request integration, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, applicable compiled API checks, and `git diff --check`.

## Known Limitations

Scopes and ABAC are not yet conjunctively enforced; PM3.3 adds them. Admin creation remains PM3.4.

## Follow-Ups

[PM3.3](phase-03-scopes-abac.md) combines scopes with resource/action authorization.

## Completion Notes

Pending implementation and validation.
