# PM2.3 — Admin Challenge Enforcement

## Status

Complete

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

- **API boundary** (`packages/admin/src/access.ts`, `router.ts`). Every `/__admin/*` request runs: same-origin → Better Auth session → `admin.access` ABAC → current-session assurance (when required) → the handler's resource/action ABAC. The first three keep their existing behavior. A session without assurance gets `403 ADMIN_2FA_REQUIRED` with `reason` `setup-required` (no confirmed factor) or `challenge-required` (factor configured, session not verified or expired).
- **Narrow challenge surface.** Only the exact method+path pairs `GET status`, `POST enroll/start`, `enroll/confirm`, `challenge`, and `recovery/verify` bypass the assurance check (they still require a session, `admin.access`, and same-origin). `recovery/regenerate` and every other route need full assurance. Any other spelling (trailing slash, double slash) fails closed to full assurance.
- **Error precedence.** `admin.access` is evaluated before assurance is disclosed, so a user without admin access receives the normal authorization denial and learns nothing about factor state.
- **Browser navigation** (`packages/admin-ui`). The root layout load turns a two-factor denial into shell state and redirects `303` to `/admin/auth/2fa/setup` or `/admin/auth/2fa`, carrying the intended URL as `next`. Framework auth pages (`/admin/auth/*`) never redirect to themselves. The admin UI HTML itself contains no admin data; every data call goes through the protected API.
- **Return URL safety** (`packages/admin-ui/src/lib/return-to.ts`). `next` is accepted only as a same-origin path under `/admin` (query kept, fragment dropped) that is not an auth page; absolute URLs, `//`, backslashes, control characters, dot-segment escapes, and over-long values become `/admin`.
- **Disabled policy.** With `required: false` the boundary skips assurance entirely; the 2FA routes still work.

## Public API

`403 { "error": { "code": "ADMIN_2FA_REQUIRED", "message": "Admin access requires two-factor verification.", "reason": "setup-required" | "challenge-required" } }` for admin API requests (never an HTML redirect); browser routes `/admin/auth/2fa/setup` and `/admin/auth/2fa` with `?next=`; `safeReturnTo` semantics as above.

## Files / Packages Changed

`packages/admin` (`access.ts`, `router.ts`, `two-factor-routes.ts`), `packages/core` (`AdminTwoFactorRequiredError`), `packages/hono` (`mapHttpError` includes the structured `reason`), `packages/admin-ui` (`metadata.ts`, layout load, `return-to.ts`), tests, [architecture](../../architecture.md), [initiative index](README.md), and this record.

## Tests

Cover unauthenticated denial, authenticated single-factor denial, configured-but-unverified denial, verified-session success, API structured errors, setup/challenge redirects, return URL safety, `admin.access` denial after challenge, resource/action ABAC, and same-origin checks.

## Acceptance Criteria

- [x] Authenticated single-factor requests are denied.
- [x] Verified sessions pass the 2FA boundary.
- [x] API requests receive structured challenge-required errors.
- [x] `admin.access` remains required.
- [x] `/admin/*` and `/__admin/*` have no assurance bypass.
- [x] Docs updated.

## Validation

`packages/admin/tests/two-factor.test.ts` (unauthenticated denial, setup-required, unverified denial, verified success, per-session assurance, non-admin users seeing only the ABAC denial, same-origin and request-shape enforcement, alternate-spelling fail-closed, opt-out) and `packages/admin-ui/tests/two-factor.test.ts` (shell state, redirects, return URL safety); `apps/example/tooling/integration.mjs` gained an admin 2FA section (not executed here — no Docker/MongoDB). Then `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`.

## Known Limitations

The existing example integration runner and any application admin flow now require enrolling a second factor (or `required: false`). Pages and their browser-level verification are PM2.4/PM2.5.

## Follow-Ups

[PM2.4](phase-04-admin-ui.md) adds the Svelte routes and client flow.

## Completion Notes

PM2.3 is complete. The boundary lives in the single admin router middleware, so there is no second enforcement path to drift.
