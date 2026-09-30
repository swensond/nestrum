# PM2.3 — Admin Challenge Enforcement

## Status

Not Started

## Goal

Require sufficient current-session assurance for all admin UI and private admin API access while preserving ABAC and same-origin rules.

## Scope

- Protect `/admin/*` and `/__admin/*` with the assurance boundary.
- Redirect browser navigation lacking configured/verified assurance to `/admin/auth/2fa` or setup when appropriate.
- Return structured `ADMIN_2FA_REQUIRED` errors for admin API requests; never HTML-redirect API calls.
- Preserve Better Auth authentication, `admin.access`, resource/action ABAC, and same-origin enforcement.
- Support return-to-original-admin-URL state safely and prevent open redirects.

## Out of Scope

Framework-owned Svelte page implementation, new factor types, full expiry/browser hardening, and replacing existing authorization checks.

## Architecture Decisions

Depends on [PM2.2](phase-02-enrollment.md). Authorization order is authentication → required assurance → `admin.access` → resource/action ABAC. An authenticated user without `admin.access` remains denied; an authorized user without assurance remains denied. Challenge routes themselves must be narrowly accessible and must not create assurance without successful verification.

## Implementation

Integrate assurance checks with the existing private admin boundary and admin UI host. Distinguish setup-required from challenge-required status. Keep API responses stable and minimally informative. Reuse existing subject/origin/session handling rather than creating bypass paths.

## Public API

Planned structured error code `ADMIN_2FA_REQUIRED` and browser challenge/setup routing behavior. Document HTTP status, response shape, and safe return URL handling after implementation.

## Files / Packages Changed

Planned `@nestrum/admin`/Hono enforcement seams, auth assurance integration, tests, [architecture](../../architecture.md), [initiative index](README.md), and this record.

## Tests

Cover unauthenticated denial, authenticated single-factor denial, configured-but-unverified denial, verified-session success, API structured errors, setup/challenge redirects, return URL safety, `admin.access` denial after challenge, resource/action ABAC, and same-origin checks.

## Acceptance Criteria

- [ ] Authenticated single-factor requests are denied.
- [ ] Verified sessions pass the 2FA boundary.
- [ ] API requests receive structured challenge-required errors.
- [ ] `admin.access` remains required.
- [ ] `/admin/*` and `/__admin/*` have no assurance bypass.
- [ ] Docs updated.

## Validation

Run targeted boundary tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, and compiled admin integration. Record status/redirect behavior and `git diff --check`.

## Known Limitations

Framework-owned setup/challenge/recovery pages are still supplied by PM2.4. Browser flow and expiry hardening remain PM2.5.

## Follow-Ups

[PM2.4](phase-04-admin-ui.md) adds the Svelte routes and client flow.

## Completion Notes

Pending implementation and validation.
