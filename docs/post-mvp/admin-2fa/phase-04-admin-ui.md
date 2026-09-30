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

- **Routes** (SvelteKit under `packages/admin-ui/src/routes/auth/`): `2fa/setup` (begin → key/`otpauth` link → activate → one-time recovery codes), `2fa` (TOTP challenge), and `recovery` (recovery-code challenge). Applications register nothing.
- **Native forms.** Every step is a plain `<form method="POST">` handled by SvelteKit form actions (`lib/two-factor.server.ts`), so the pages work without client JavaScript and reuse SvelteKit's origin check. Server actions call the private API through `event.fetch`, whose `handleFetch` already forwards the session cookie, `Origin`, and `Sec-Fetch-Site`.
- **Return-to.** Forms carry a hidden `next` that is re-validated with `safeReturnTo` on the server; success redirects `303` to it.
- **No secret persistence.** The setup key appears only in the `start` action's result; a failed activation never re-renders it and offers "Start over with a new key". The recovery codes appear only in the `confirm` action's result and cannot be fetched again. Responses carry the existing `Cache-Control: private, no-store`. The setup page deliberately does not redirect away from a freshly verified session, because the reload after activation would otherwise hide the recovery codes.
- **Accessibility.** Labeled inputs, `autocomplete="one-time-code"`/`inputmode="numeric"` for TOTP, `role="alert"` for errors, plain links between challenge and recovery. Visual polish beyond function is out of scope.
- **Messages.** Backend failures map to fixed safe messages (invalid code, locked, expired session, generic); response bodies are never echoed.

## Public API

Browser routes `/admin/auth/2fa/setup`, `/admin/auth/2fa`, `/admin/auth/recovery`; form actions `?/start` and `?/confirm` on setup and the default action elsewhere, all taking `code` (bounded, single value) and `next`.

## Files / Packages Changed

`packages/admin-ui` (`routes/auth/**`, `lib/two-factor.server.ts`, `lib/return-to.ts`, `AdminShell.svelte` two-factor state, `vitest.config.ts` `$lib` alias), tests, [architecture](../../architecture.md), [initiative index](README.md), and this record.

## Tests

Cover Svelte rendering/forms, setup/challenge/recovery states, successful return navigation, API error handling, cookie/origin forwarding, no plaintext-code caching, native form fallback, and `svelte-check-native`.

## Acceptance Criteria

- [x] No application-owned Svelte MFA code is required.
- [x] Setup, challenge, and recovery pages work.
- [x] Successful challenge returns to intended route.
- [x] Recovery flow works.
- [x] `svelte-check-native` passes.
- [x] Docs updated.

## Validation

`packages/admin-ui/tests/two-factor.test.ts` (server-rendered pages for every setup step, form parsing, safe-message mapping, network failure, malformed forms rejected before any API call), `pnpm --filter @nestrum/admin-ui check` (`svelte-check-native`), `pnpm build`/`verify:build`, `pnpm test`, `pnpm typecheck`, `pnpm check`. The pages were then driven end to end in Chromium (see PM2.5).

## Known Limitations

No rendered QR image; users add the account via the `otpauth://` link or manual key. Pages are functional, not visually designed. No UI for regenerating recovery codes yet (the API exists).

## Follow-Ups

[PM2.5](phase-05-hardening.md) hardens expiry, browser coverage, and production diagnostics.

## Completion Notes

PM2.4 is complete. The build/asset behavior is unchanged: the pages compile into the existing prebuilt admin shell.
