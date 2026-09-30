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

- **API boundary** (`packages/admin/src/access.ts`, `router.ts`). Every `/__admin/*` request runs: same-origin → Better Auth session → `admin.access` ABAC → assurance (when required) → the handler's resource/action ABAC. A session that fails assurance gets `403 ADMIN_2FA_REQUIRED` with `reason` `setup-required` (no active factor) or `challenge-required` (see the `sessionAssurance` rules in PM2.1). The error is thrown by the single admin router middleware, so there is no second enforcement path.
- **Error precedence.** `admin.access` is decided before assurance is disclosed, so a user without admin access receives the normal authorization denial and learns nothing about their factor state.
- **Browser navigation** (`packages/admin-ui`). The root layout load turns a two-factor denial into shell state and redirects `303` to `/admin/auth/2fa/setup` or `/admin/auth/2fa`, carrying the intended URL as `next`; auth pages never redirect to themselves. Unauthenticated browsers, including a pending second-factor sign-in, see the framework sign-in or challenge page. The admin UI HTML contains no admin data; every data call goes through the protected API.
- **Return URL safety** (`lib/return-to.ts`). `next` is accepted only as a same-origin path under `/admin` (query kept, fragment dropped) that is not an auth page; absolute URLs, `//`, backslashes, control characters, dot-segment escapes, and over-long values become `/admin`.
- **Disabled policy.** With `required: false` the boundary skips assurance entirely.
- **No private 2FA routes.** Challenge and enrollment traffic goes to Better Auth's own endpoints (PM2.2), which need no admin-specific bypass.

## Public API

`403 { "error": { "code": "ADMIN_2FA_REQUIRED", "message": "Admin access requires two-factor verification.", "reason": "setup-required" | "challenge-required" } }` for admin API requests (never an HTML redirect); browser routes `/admin/auth/2fa/setup` and `/admin/auth/2fa` with `?next=`.

## Files / Packages Changed

`packages/admin` (`access.ts`, `router.ts`, `security.ts`), `packages/core` (`AdminTwoFactorRequiredError`), `packages/hono` (`mapHttpError` includes the structured `reason`), `packages/admin-ui` (`metadata.ts`, layout load, `return-to.ts`), tests, [architecture](../../architecture.md), [initiative index](README.md), and this record.

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

`packages/admin/tests/two-factor.test.ts` (unauthenticated denial, setup-required, non-admin users seeing only the ABAC denial, enrolled-session success, stale pre-enrollment session denied, sign-in without a code yielding no session, session-age limit, backup code, same-origin, alternate-spelling fail-closed, opt-out) and `packages/admin-ui/tests/two-factor.test.ts` (shell state, redirects, return-URL safety); the compiled shell is checked by `admin-ui verify:build`. Then `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`.

## Known Limitations

The example integration runner and any admin flow now require enrolling a second factor (or `required: false`). Stale sessions can only be renewed by signing in again.

## Follow-Ups

[PM2.4](phase-04-admin-ui.md) adds the Svelte routes and client flow.

## Completion Notes

PM2.3 is complete.
