# PM3.4 — Admin API-Key Management

## Status

Not Started

## Goal

Provide framework-owned secure API-key management through protected admin UI and API.

## Scope

- Add `/admin/api-keys` list/create/revoke/rotate management.
- Add `/__admin/api-keys/*` private operations.
- Require Better Auth, admin 2FA, `admin.access`, management ABAC, and same-origin policy.
- Require `api-key.create` authorization for creation.
- Show the secret once with explicit “This key will not be shown again” messaging; never show it later.
- Configure owners, scopes, expiry, metadata, and inspect safe prefix/last-used data.

## Out of Scope

Rate-limit enforcement, final redaction/rotation hardening, non-admin management, and application-owned key pages.

## Architecture Decisions

Depends on [PM3.3](phase-03-scopes-abac.md) and the completed PM2 assurance boundary. Key management is a high-impact admin operation and must not bypass any existing session/origin/ABAC layer. Never return stored plaintext. UI and API must distinguish one-time creation response from later metadata reads.

## Implementation

Planned generic metadata-driven admin views plus dedicated key-management operations. Protect direct API calls as well as browser routes. Revoke is stateful (`revokedAt`); rotate creates a replacement and reveals it once before revoking the predecessor according to the documented policy.

## Public API

Planned `/admin/api-keys` and `/__admin/api-keys/*` routes, management ABAC action names, safe metadata response, and one-time secret response. Document exact actions/statuses after implementation.

## Files / Packages Changed

Planned admin/admin-ui/auth integration, route/ABAC registration, tests, [architecture](../../architecture.md), [initiative index](README.md), and this record.

## Tests

Cover admin 2FA requirement, create/list/revoke/rotate, owner/scope/expiry configuration, one-time reveal, direct API protection, same-origin, management ABAC, and no secret in later responses or logs.

## Acceptance Criteria

- [ ] Admin 2FA is required.
- [ ] Create/list/revoke work.
- [ ] Rotation works according to policy.
- [ ] Secret is shown once only.
- [ ] Owner/scopes/expiry are configurable.
- [ ] Docs updated.

## Validation

Run targeted admin/API tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, applicable Svelte/browser checks, and `git diff --check`.

## Known Limitations

Rate limiting, last-use operational details, and final redaction/rotation integration are PM3.5.

## Follow-Ups

[PM3.5](phase-05-hardening.md) adds operational hardening and end-to-end integration.

## Completion Notes

Pending implementation and validation.
