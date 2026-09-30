# PM2.5 — Admin 2FA Hardening

## Status

Complete

## Goal

Complete assurance expiry, re-challenge, security diagnostics, error handling, and browser-level verification.

## Scope

- Enforce assurance TTL and re-challenge after expiry while preserving a valid login session.
- Add complete Playwright enrollment/challenge/recovery/return-route coverage.
- Verify no admin UI/API bypass, including direct private API and route variations.
- Harden error handling, redaction, rate/attempt behavior as required by the implementation, and development opt-out diagnostics.
- Update architecture, roadmap, phase records, and definition-of-done status to actual behavior.

## Out of Scope

Passkeys/WebAuthn implementation, optional non-admin MFA policy, automatic database migration behavior, and unrelated admin redesign.

## Architecture Decisions

Depends on PM2.1–PM2.4. Expiry is independent from login validity and must be checked server-side on every protected admin boundary. Browser and API behavior remain distinct. Any rate limiting, lockout, or retry policy introduced must be explicit, tested, and avoid turning recovery into a bypass. Production diagnostics never expose secrets or assurance internals.

## Implementation

- **Session limit and re-challenge.** A session older than `assuranceTtlSeconds` (measured from its creation, which for an enrolled user is the verified sign-in) is denied on every protected admin request with `challenge-required`; the login session is untouched and the UI offers "Sign in again". Verified with a fake clock (Vitest), and in Chromium with a real 60 s limit.
- **Pre-enrollment sessions.** A single-factor session created before 2FA was enabled cannot become an admin session: activation replaces the enrolling session, and any other older session is older than the user's update and is denied.
- **Attempt limiting** is the plugin's account lockout (default 10 failures, 900 s, configurable), shared by TOTP and backup codes, and refuses even a correct code while locked (`429`).
- **Redaction and errors.** Stored secrets and backup codes are encrypted by the plugin; `enable` returns the secret once inside the `otpauth://` URI; UI messages are fixed strings; `ADMIN_2FA_REQUIRED` reveals only setup versus challenge.
- **Diagnostics.** `nestrum dev` prints `Admin security / 2FA required yes` by default, and `2FA required no` plus `WARNING / Admin 2FA is disabled for this application.` on explicit opt-out; production adds nothing.
- **Verification.** Vitest covers the boundary and bypass attempts. `apps/example/tooling/integration.mjs` has a 2FA and staff-elevation section (Docker + MongoDB); the project owner ran it and it passes. `apps/example/tooling/admin-2fa-browser.mjs` (`pnpm --filter @nestrum/example e2e:admin-2fa`) drives Chromium through password-confirmed enrollment, invalid/valid TOTP, challenge with return-to, backup-code single use, open-redirect fallback, and the session-limit re-challenge against a real PostgreSQL identity database.

## Public API

Final configuration: `admin.security.twoFactor.{required, assuranceTtlSeconds}` and `defineAuth({ twoFactor: { issuer, maxFailedAttempts, lockoutSeconds } })`. Error and route behavior is documented in PM2.2–PM2.3.

## Files / Packages Changed

`packages/cli` (`adminSecurityDiagnostics`), `apps/example` (role-based staff via the admin interface, integration runner, browser script), earlier-phase code, [architecture](../../architecture.md), [post-MVP roadmap](../../post-mvp.md), and all PM2 records.

## Tests

Vitest: assurance expiry, re-challenge, ABAC after challenge, recovery reuse, structured errors, and bypass attempts. Playwright: enrollment, invalid/valid TOTP, recovery, return route, expiry/re-challenge, direct API, and same-origin behavior.

## Acceptance Criteria

- [x] Browser flow passes end to end.
- [x] Session-limit expiry and re-challenge are tested.
- [x] No admin bypass exists.
- [x] Security diagnostics and error handling are verified.
- [x] Docs describe actual implementation.
- [ ] Initiative definition of done: all items pass except "Assurance expires independently from login", which was replaced by a session-age limit (see PM2.1).

## Validation

Run in this environment: `pnpm test`, `pnpm typecheck` (including `svelte-check-native`), `pnpm build`, `admin-ui verify:build`, `cli verify:build`, biome, `git diff --check`; `nestrum db generate/migrate/status` for the identity database on local PostgreSQL 16; and the Playwright script above (Chromium). The Docker + MongoDB `pnpm test:integration` cannot run in this environment (no Docker daemon); the project owner ran it and it passes. The plugin's MongoDB behavior (`Date?` and `Int?` fields, `_id` mapping) is covered by the drift test only.

## Known Limitations

No independent assurance expiry (bounded by session age); no QR image; no UI to regenerate backup codes or disable 2FA; lockout is per account and shared with the public app; 2FA challenges apply to every client of a user who enables it; TOTP secrets depend on `AUTH_SECRET`; the browser script is a manual/CI-optional check, not part of `pnpm check`. Passkeys/WebAuthn and non-admin MFA policy remain deferred.

## Follow-Ups

Record future factors, configurable policy extensions, and operational controls in the post-MVP roadmap after PM2 completion.

## Completion Notes

PM2 is complete against a revised definition of done (session-age limit instead of independent expiry), and the project owner's Docker + MongoDB integration run passing.
