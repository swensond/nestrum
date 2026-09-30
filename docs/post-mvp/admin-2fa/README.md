# Nestrum Post-MVP Plan 02 — Admin 2FA Enforcement

## Status and navigation

This is the second post-MVP initiative. PM2.0–PM2.5 are Complete: admin 2FA is required by default for the admin UI and private admin API, with framework-owned TOTP enrollment, recovery codes, and setup/challenge/recovery pages. The Docker integration run of the example (which now performs a real 2FA flow) belongs to the project owner and was not executed during implementation; everything else is recorded in the phase documents. This initiative does not change the remaining MVP gate for atomic object-policy writes.

| Phase | Goal | Primary surface | Status |
| --- | --- | --- | --- |
| [PM2.0 — Contract](phase-00-contract.md) | Document default-required admin 2FA and enforcement boundaries | docs/core contracts | Complete |
| [PM2.1 — Session assurance](phase-01-assurance.md) | Add an explicit, expiring assurance abstraction | auth/session contracts | Complete |
| [PM2.2 — Enrollment and recovery](phase-02-enrollment.md) | Implement TOTP setup and secure recovery codes | auth/admin backend | Complete |
| [PM2.3 — Admin challenge](phase-03-challenge.md) | Enforce assurance on admin UI and API boundaries | admin middleware/routes | Complete |
| [PM2.4 — Admin UI](phase-04-admin-ui.md) | Provide framework-owned setup/challenge/recovery pages | `@nestrum/admin-ui` | Complete |
| [PM2.5 — Hardening](phase-05-hardening.md) | Verify expiry, security diagnostics, and browser flows | integration/security | Complete |

The existing admin boundary is Better Auth session + `admin.access` ABAC + same-origin policy. This initiative adds an explicit current-session `two-factor` assurance requirement:

```text
Better Auth session
        ↓
Nestrum AuthContext
        ↓
AdminAssuranceService
        ↓
admin.access ABAC
        ↓
same-origin policy
```

All of these are always enforced, in this order: authentication, `admin.access` ABAC, required 2FA assurance, then resource/action authorization. (The conceptual order in the diagram puts assurance before `admin.access`; the implementation evaluates `admin.access` first only so that users who may not use administration learn nothing about their factor state. The allow/deny outcome is identical.) 2FA never replaces authorization.

## 1. Default security rule

Admin 2FA is enabled by default. The target configuration is:

```ts
admin: {
  security: {
    twoFactor: {
      required: true,
    },
  },
}
```

An explicit opt-out may be supported:

```ts
admin: {
  security: {
    twoFactor: {
      required: false,
    },
  },
}
```

If disabled, `nestrum dev` displays a visible warning. The exact config merge/default behavior must be finalized in PM2.1 and documented in the implementation record.

## 2. Better Auth relationship and assurance semantics

Better Auth remains the authentication foundation. Nestrum adds an admin-specific assurance layer and must distinguish a user having configured 2FA from the current session having completed a challenge.

The target assurance vocabulary is:

```ts
type AssuranceLevel = "single-factor" | "two-factor";
```

The exact internal API may vary, but current-session state must be explicit and independently expirable. Admin requires `two-factor` by default. A login session may remain valid while its admin assurance becomes insufficient.

Target configuration:

```ts
admin: {
  security: {
    twoFactor: {
      required: true,
      assuranceTtlSeconds: 43200,
    },
  },
}
```

The assurance TTL is applied to the current session/challenge state, not the login session lifetime. Expiry requires another challenge before admin access resumes.

## 3. Initial factor and enrollment

TOTP is the first supported factor. The assurance abstraction must leave room for passkeys/WebAuthn later without changing admin enforcement.

For an admin-authorized user without configured 2FA:

```text
/admin
  ↓
authenticated
  ↓
admin.access allowed
  ↓
2FA not configured
  ↓
/admin/auth/2fa/setup
```

Enrollment generates a TOTP secret and QR/`otpauth` information, requires a valid TOTP before activation, generates recovery codes, and marks the factor configured only after successful verification. Generating a secret alone never activates 2FA.

## 4. Challenge and recovery

For a configured factor with insufficient current-session assurance, redirect browser navigation to `/admin/auth/2fa`. Support TOTP and a recovery code, then return to the original admin URL after success.

Admin API requests never receive an HTML redirect. They receive a structured error such as:

```json
{
  "error": {
    "code": "ADMIN_2FA_REQUIRED"
  }
}
```

Recovery codes are cryptographically generated, shown once, hashed at rest, one-time use, and regeneratable. Regeneration invalidates the previous set. Plaintext codes must not be retained after issuance.

## 5. Admin UI and API surfaces

Framework-owned Svelte routes are planned at `/admin/auth/2fa/setup`, `/admin/auth/2fa`, and `/admin/auth/recovery`. The consuming application writes no MFA pages.

Private routes are planned under `/__admin/auth/2fa/*` for status, enrollment start/confirmation, challenge verification, recovery verification, and recovery regeneration. All ordinary `/__admin/*` endpoints reject sessions that do not satisfy required assurance. Existing Better Auth session, `admin.access`, and same-origin checks remain active.

## 6. Diagnostics and security

Development diagnostics include:

```text
Admin security
  2FA required    yes
```

An explicit opt-out displays:

```text
WARNING
Admin 2FA is disabled for this application.
```

Production diagnostics must not expose TOTP secrets, recovery codes, session internals, or sensitive enrollment state. Failure responses reveal only the minimum challenge/status information needed by the browser client.

## 7. Testing strategy

Vitest must cover unauthenticated denial, authenticated single-factor denial, enrollment activation rules, invalid/valid TOTP, recovery use and reuse rejection, assurance expiry, and continued ABAC enforcement after challenge. Playwright must cover browser enrollment, challenge, recovery, return-to-intended-route, and expiry/re-challenge behavior.

## 8. Definition of done

- [x] Admin 2FA is required by default.
- [x] TOTP enrollment is framework-owned.
- [x] Recovery codes are secure, hashed, one-time use, and shown only once.
- [x] The current session must satisfy second-factor assurance.
- [x] `/admin/*` enforces assurance.
- [x] `/__admin/*` enforces assurance.
- [x] `admin.access` ABAC remains mandatory.
- [x] Assurance expires independently from login.
- [x] The consuming application writes no custom admin MFA code.
- [x] Documentation reflects actual implementation.

Each phase updates documentation and leaves the repository green. See [architecture](../../architecture.md), [post-MVP roadmap](../../post-mvp.md), and the standard [phase documentation requirements](../../phases/README.md#completion-requirements).
