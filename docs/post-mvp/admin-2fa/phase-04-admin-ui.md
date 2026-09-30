# PM2.4 — Svelte Admin 2FA UI

## Status

Complete

## Goal

Provide framework-owned setup, challenge, and recovery pages without application-owned MFA components.

## Scope

- Implement `/admin/auth/2fa/setup`, `/admin/auth/2fa`, and `/admin/auth/recovery`.
- Consume private 2FA status/enrollment/challenge/recovery APIs.
- Render QR/otpauth enrollment information, TOTP entry, recovery-code issuance/use, and errors.
- Return successfully challenged users to the intended admin route.
- Preserve session cookies, same-origin behavior, SSR/native form behavior, and admin shell boundaries.

## Out of Scope

Backend assurance/enrollment implementation, WebAuthn, visual polish beyond functional accessibility, and final browser hardening.

## Architecture Decisions

Depends on [PM2.3](phase-03-challenge.md) and existing admin-ui conventions. Pages are framework-owned and metadata-independent. Never render secret/recovery data after its issuance response; avoid leaking challenge state through cached HTML or assets. Server-side API responses remain authoritative.

## Implementation

- **Routes** (SvelteKit under `packages/admin-ui/src/routes/auth/`): `2fa/setup`, `2fa` (TOTP challenge), and `recovery` (backup-code challenge). Applications register nothing.
- **Client-side forms** calling Better Auth's endpoints with same-origin credentials (`lib/two-factor-client.ts`). Cookies are handled by the browser, so the session/two-factor cookies Better Auth sets apply directly. Consequently these pages need JavaScript; the existing sign-in form already did. Forms are `method="POST"` so a script-less submit can never place a password in a URL.
- **Setup**: confirm password → key, `otpauth://` link, and backup codes (shown once, before activation) → enter a code to activate → success screen keeps the codes until the user continues (a full navigation, since activation replaces the session).
- **Challenge / recovery**: on success a full navigation to the sanitized `next` picks up the new session. A session that is merely stale (`challenge-required`) shows "Sign in again", which signs out and returns to `next` so the normal sign-in and challenge run.
- **Shell**: after a password sign-in that returns `twoFactorRedirect`, the shell navigates to the challenge page with the current path as `next`; framework auth pages render inside the shell even while signed out.
- **Messages** are fixed and safe: invalid code, locked, expired sign-in, wrong password, generic. Response bodies are never echoed. Pages inherit `Cache-Control: private, no-store`.

## Public API

Browser routes `/admin/auth/2fa/setup`, `/admin/auth/2fa`, `/admin/auth/recovery` (each accepting `?next=`).

## Files / Packages Changed

`packages/admin-ui` (`routes/auth/**`, `lib/two-factor-client.ts`, `lib/return-to.ts`, `AdminShell.svelte`, layout, `vitest.config.ts` `$lib` alias), tests, [architecture](../../architecture.md), [initiative index](README.md), and this record.

## Tests

Cover Svelte rendering/forms, setup/challenge/recovery states, successful return navigation, API error handling, cookie/origin forwarding, no plaintext-code caching, native form fallback, and `svelte-check-native`.

## Acceptance Criteria

- [x] No application-owned Svelte MFA code is required.
- [x] Setup, challenge, and recovery pages work.
- [x] Successful challenge returns to the intended route.
- [x] Recovery flow works.
- [x] `svelte-check-native` passes.
- [x] Docs updated.
- Note: the plan's "native form fallback" is not met; the pages require JavaScript.

## Validation

`packages/admin-ui/tests/two-factor.test.ts` (client requests and safe-message mapping, page rendering for each state, shell behavior on auth paths), `pnpm --filter @nestrum/admin-ui check` (`svelte-check-native`), `admin-ui verify:build` against the compiled shell, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`. The pages were driven end to end in Chromium (PM2.5).

## Known Limitations

No rendered QR image. Pages are functional, not visually designed. No UI for regenerating backup codes or disabling 2FA. JavaScript is required.

## Follow-Ups

[PM2.5](phase-05-hardening.md) hardens expiry, browser coverage, and production diagnostics.

## Completion Notes

PM2.4 is complete. The pages compile into the existing prebuilt admin shell.
