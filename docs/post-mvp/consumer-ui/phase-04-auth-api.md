# PM4.4 — Consumer Auth and API Client

## Status

Not Started

## Goal

Provide Nestrum-aware browser helpers for Better Auth sessions and public API access.

## Scope

- Expose current session, current user, sign-in, sign-out, and auth state helpers.
- Preserve cookies/session credentials and same-origin behavior.
- Provide a public API client with same-origin base, Nestrum errors, and framework auth behavior.
- Keep private admin API and admin-only metadata unavailable through consumer helpers.

## Out of Scope

Admin UI/auth helpers, API-key management, server-secret serialization, SSR-specific auth, and new auth providers.

## Architecture Decisions

Depends on [PM4.3](phase-03-dev.md), existing Better Auth contracts, and the public API boundary. Browser helpers are narrower than server/admin APIs; client errors do not expose secrets or internal admin data.

## Implementation

Planned browser-safe helpers and request client. Define loading/error/session state, sign-in/out contracts, API serialization, and handling of 401/standard Nestrum errors. Keep server-only configuration and private routes out of client bundles.

## Public API

Planned consumer auth and public API client exports, explicitly excluding private admin API.

## Files / Packages Changed

Planned web/auth client and public API helper code, tests, architecture, initiative index, and this record.

## Tests

Cover session/user, sign-in/out, auth state, cookie forwarding, public API success/errors, same-origin base, and proof admin helpers are not exposed.

## Acceptance Criteria

- [ ] Current session is accessible.
- [ ] Sign-in/sign-out work.
- [ ] Public API client works.
- [ ] Admin API is not exposed.
- [ ] Docs updated.

## Validation

Run client/auth/API tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, browser checks, and `git diff --check`.

## Known Limitations

Client/runtime config filtering and final production asset security remain PM4.5.

## Follow-Ups

[PM4.5](phase-05-hardening.md) verifies route, config, asset, and E2E security.

## Completion Notes

Pending implementation and validation.
