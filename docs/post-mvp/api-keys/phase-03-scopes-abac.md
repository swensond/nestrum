# PM3.3 — Scopes and ABAC Integration

## Status

Not Started

## Goal

Enforce API-key scopes and existing resource/action ABAC together.

## Scope

- Define scope naming/normalization and required-scope mapping for resource operations.
- Add API-key scope attributes to explicit subjects.
- Deny when scope is insufficient even if ABAC allows.
- Deny when ABAC disallows even if scope allows.
- Preserve human-session authorization and resource operation defaults.

## Out of Scope

Admin UI/API, rate-limit providers, rotation hardening, and replacing ABAC with scopes.

## Architecture Decisions

Depends on [PM3.2](phase-02-authentication.md). Effective authorization is the intersection of scope permission and ABAC permission. Scope checks must be explicit, fail closed, and occur before the handler while retaining normal QuerySet/resource policy checks. API-key subjects may be distinguished by type/attributes in policies.

## Implementation

Planned operation-to-scope mapping and authorization context integration for public resource APIs. Validate resource auth configuration and scope declarations during startup/build where possible. Avoid allowing arbitrary client-provided scope claims.

## Public API

Planned scope strings such as `projects:read`, `projects:write`, and `events:write`, resource auth configuration, and authorization failure behavior. Document custom scope extension rules after implementation.

## Files / Packages Changed

Planned core/resource/ABAC/Hono integration, tests, [architecture](../../architecture.md), [initiative index](README.md), and this record.

## Tests

Cover scope allow/deny, ABAC allow/deny, combined denial, operation mapping, API-key versus human subjects, object/collection policy checks, and fail-closed malformed scope input.

## Acceptance Criteria

- [ ] Key scope can deny.
- [ ] ABAC can deny.
- [ ] Both must allow.
- [ ] Resource can opt into API-key auth and scope requirements.
- [ ] Docs updated.

## Validation

Run targeted authorization/API tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, applicable integration checks, and `git diff --check`.

## Known Limitations

Management UI/API and operational rate limiting remain PM3.4/PM3.5.

## Follow-Ups

[PM3.4](phase-04-admin.md) adds secure admin management protected by PM2 2FA.

## Completion Notes

Pending implementation and validation.
