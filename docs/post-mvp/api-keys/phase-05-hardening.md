# PM3.5 — API-Key Hardening

## Status

Not Started

## Goal

Complete last-use tracking, rate limiting, rotation, secret redaction, and real resource API integration.

## Scope

- Track `lastUsedAt` safely and define update/failure semantics.
- Provide a framework rate-limit path with a simple initial provider and an extension seam for Redis/external backends.
- Test rotation, expiry, revocation, one-time reveal, and any documented overlap policy.
- Verify logs/errors/diagnostics redact credentials and sensitive metadata.
- Run full API-key resource, admin, and security integration coverage.
- Update architecture, roadmap, and phase records to actual shipped behavior.

## Out of Scope

Service identities, WebAuthn, arbitrary external rate-limit implementations, browser-session exchange, and unrelated API redesign.

## Architecture Decisions

Depends on PM3.1–PM3.4. Rate limiting is framework metadata and policy, not a reason to weaken authentication or ABAC. Failed credentials must not update successful-use metadata. Rotation/revocation must be atomic from the caller's perspective as far as the storage contract permits. Document concurrency and clock assumptions.

## Implementation

Planned end-to-end verification of the request pipeline: extraction → hash verification → expiry/revocation → rate limit → API-key subject → scope → ABAC → handler. Include production-safe redaction and diagnostics, plus admin 2FA/key-management checks.

## Public API

Finalize key format, canonical header, resource auth modes, scope vocabulary/extension, TTL, rate-limit configuration/provider seam, rotation semantics, and error/status behavior. Update the initiative index and architecture only to describe shipped behavior.

## Files / Packages Changed

Planned auth/core/Hono/resource/admin/admin-ui integration tests and hardening, [architecture](../../architecture.md), [post-MVP roadmap](../../post-mvp.md), and all PM3 records.

## Tests

Vitest: valid/invalid/expired/revoked keys, scope/ABAC denial, owner mapping, rate-limit boundary, rotation, last-use, plaintext non-persistence, and redaction. Integration: actual opt-in resource API authentication and protected admin management.

## Acceptance Criteria

- [ ] Rate limits are tested.
- [ ] Rotation is tested.
- [ ] Logs and errors redact secrets.
- [ ] Resource API integration passes.
- [ ] Admin 2FA/key-management integration passes.
- [ ] Docs updated.
- [ ] Initiative definition of done passes and PM3 is marked complete.

## Validation

Run targeted security/resource/admin integration, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, applicable browser checks, and `git diff --check`. Record evidence before marking Complete.

## Known Limitations

Future owner types, factors, and external rate-limit providers remain separately scoped. Document any provider/runtime limitations demonstrated by the implementation.

## Follow-Ups

Record service identities, broader transports, external rate-limit adapters, and additional key policy controls in the post-MVP roadmap after PM3 completion.

## Completion Notes

Pending implementation and validation. PM3 remains incomplete until all phases and definition-of-done items pass.
