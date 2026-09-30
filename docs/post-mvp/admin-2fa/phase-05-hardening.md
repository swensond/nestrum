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

- **Expiry and re-challenge.** Assurance expires at `verifiedAt + assuranceTtlSeconds` (exclusive), is checked on every protected admin request, and never affects the Better Auth login session. Verified with a controlled clock (Vitest), against real PostgreSQL, and in a browser with a real 60 s TTL.
- **Attempt limiting.** Five consecutive failed TOTP/recovery attempts (`MAX_FAILED_ATTEMPTS`) lock the factor for 300 s (`LOCKOUT_SECONDS`), reported as `429 TWO_FACTOR_LOCKED` before any code is evaluated (a correct code during the lock is refused, so the lock is not an oracle). The counter is shared by TOTP and recovery codes so recovery is not a bypass, is updated with compare-and-set so concurrent guesses cannot skip it, and resets on success.
- **Redaction and errors.** Only the private API returns secrets, once; errors carry a code and fixed message; `ADMIN_2FA_REQUIRED` reveals only the setup/challenge distinction. Responses are `no-store`.
- **Diagnostics.** `nestrum dev` prints `Admin security / 2FA required yes` by default, and `2FA required no` plus `WARNING / Admin 2FA is disabled for this application.` on explicit opt-out; production adds nothing.
- **Verification.** Vitest covers expiry, re-challenge, ABAC after challenge, replay and recovery reuse, lockout, structured errors, and bypass attempts. `apps/example/tooling/integration.mjs` has a Docker-run 2FA section (for the project owner). `apps/example/tooling/admin-2fa-browser.mjs` (`pnpm --filter @nestrum/example e2e:admin-2fa`) is a Playwright script that drives enrollment, invalid/valid TOTP, recovery, return-to, open-redirect fallback, and expiry/re-challenge against a real PostgreSQL identity database.

## Public API

Final configuration: `admin.security.twoFactor.{required, assuranceTtlSeconds}`; `MAX_FAILED_ATTEMPTS`/`LOCKOUT_SECONDS` are fixed constants (not configurable yet). Error/route behavior is documented in PM2.2–PM2.3.

## Files / Packages Changed

`packages/cli` (`adminSecurityDiagnostics`), `apps/example` (integration runner, browser script), auth/admin/admin-ui hardening from earlier phases, [architecture](../../architecture.md), [post-MVP roadmap](../../post-mvp.md), and all PM2 records.

## Tests

Vitest: assurance expiry, re-challenge, ABAC after challenge, recovery reuse, structured errors, and bypass attempts. Playwright: enrollment, invalid/valid TOTP, recovery, return route, expiry/re-challenge, direct API, and same-origin behavior.

## Acceptance Criteria

- [x] Browser flow passes end to end.
- [x] Assurance expiry and re-challenge are tested.
- [x] No admin bypass exists.
- [x] Security diagnostics and error handling are verified.
- [x] Docs describe actual implementation.
- [x] Initiative definition of done passes and PM2 is marked complete.

## Validation

Run in this environment: `pnpm test` (514 tests), `pnpm typecheck` (including `svelte-check-native`), `pnpm build`, `pnpm --filter @nestrum/admin-ui verify:build`, `pnpm --filter @nestrum/cli verify:build`, biome, `git diff --check`; `nestrum db generate/migrate/status` for the identity database on local PostgreSQL 16; a scripted HTTP run of enrollment/challenge/replay/recovery/expiry/lockout on that database; and the Playwright script above (Chromium). **Not run here:** the Docker+MongoDB `pnpm test:integration` (no Docker daemon) — the project owner runs it. Its new 2FA section is unexecuted.

## Known Limitations

Lockout and TTL bounds are not configurable; there is no admin UI to regenerate recovery codes or reset another user's factor; TOTP secrets are bound to `AUTH_SECRET` (rotation requires re-enrollment); the browser script is a manual/CI-optional check, not part of `pnpm check`. Passkeys/WebAuthn and non-admin MFA remain deferred.

## Follow-Ups

Record future factors, configurable policy extensions, and operational controls in the post-MVP roadmap after PM2 completion.

## Completion Notes

PM2 is complete against its definition of done, with the caveat that the Docker integration run for the example (which now performs real 2FA) is owned by the project owner and was not executed here.
