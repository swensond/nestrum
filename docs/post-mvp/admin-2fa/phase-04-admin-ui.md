# PM2.4 — Svelte Admin 2FA UI

## Status

Not Started

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

Add routes/components to the existing Svelte admin shell. Handle setup-required, challenge-required, recovery, invalid-code, expired-assurance, and retry states. Make return-to-admin navigation explicit and safe. Do not require consuming applications to register components or routes.

## Public API

Framework-owned browser routes listed in the initiative README. Document form/API interactions and accessibility expectations after implementation.

## Files / Packages Changed

Planned `packages/admin-ui` routes/components, private API client helpers, tests, [architecture](../../architecture.md), [initiative index](README.md), and this record.

## Tests

Cover Svelte rendering/forms, setup/challenge/recovery states, successful return navigation, API error handling, cookie/origin forwarding, no plaintext-code caching, native form fallback, and `svelte-check-native`.

## Acceptance Criteria

- [ ] No application-owned Svelte MFA code is required.
- [ ] Setup, challenge, and recovery pages work.
- [ ] Successful challenge returns to intended route.
- [ ] Recovery flow works.
- [ ] `svelte-check-native` passes.
- [ ] Docs updated.

## Validation

Run targeted admin-ui tests, `svelte-check-native`, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, and applicable browser checks. Record asset/cache behavior and `git diff --check`.

## Known Limitations

Full Playwright enrollment/challenge/expiry coverage and security diagnostics are PM2.5.

## Follow-Ups

[PM2.5](phase-05-hardening.md) hardens expiry, browser coverage, and production diagnostics.

## Completion Notes

Pending implementation and validation.
