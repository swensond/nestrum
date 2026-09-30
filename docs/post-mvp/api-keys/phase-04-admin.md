# PM3.4 — Admin API-Key Management

## Status

Complete

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

- **Private API.** `GET /__admin/api-keys/capabilities`, `GET /__admin/api-keys?limit&offset&ownerId`, `POST /__admin/api-keys`, `POST /__admin/api-keys/:id/revoke`, `POST /__admin/api-keys/:id/rotate` (`packages/admin/src/api-key-routes.ts`). They run behind the complete admin boundary (same-origin check, Better Auth session, `admin.access`, admin 2FA assurance) and then each operation requires its own `api-key` ABAC action: `read`, `create`, `revoke`, `rotate`. A missing policy action denies. Unknown subpaths and wrong methods under the prefix are 404. Responses are `Cache-Control: no-store`; request bodies are strictly validated.
- **Policies.** `roleBasedAdminPolicies()` now includes an `api-key` policy granting all four actions to `admin` only; staff may use administration but not manage keys. Applications can replace it.
- **Secret handling.** The key is in the create and rotate responses only; list, revoke, and later reads never contain it.
- **Svelte UI.** `/admin/api-keys` (list, create form with name, owner user ID, scopes, expiry, rate limit, revoke and rotate forms; native forms and SvelteKit actions, no client script required). The layout shows the nav link only when the capabilities endpoint says the subject can read keys. A one-time panel, "This key will not be shown again.", appears only in the action response that created or rotated the key (never in a redirect, URL, or the following load), and pages are `no-store`. The user-access page now shows user IDs so owners can be chosen.
- **Owners.** Keys belong to a user chosen by ID; creation fails (`API_KEY_OWNER_NOT_FOUND`) for unknown owners.
- **Rotation policy.** Create the replacement with the same name, owner, scopes, lifetime, rate limit, and metadata, reveal it once, revoke the predecessor (revoking the replacement if that fails). Only active keys rotate (409 otherwise). No grace-period overlap.

## Public API

`/__admin/api-keys*` as above; ABAC identity `api-key` (`API_KEY_IDENTITY`) with actions `read`, `create`, `revoke`, `rotate` (`API_KEY_ACTIONS`); create body `{ name, ownerId, scopes, expiresInDays?, rateLimit?, metadata? }` → `201 { key, secret }`; rotate → `{ key, secret, revoked }`; revoke → `{ key }`; list → `{ keys, total, limit, offset }`. Safe error messages in the UI are fixed strings keyed by error code.

## Files / Packages Changed

`packages/admin` (`api-key-routes.ts`, `policies.ts`, `router.ts`), `packages/admin-ui` (`api-keys.server.ts`, `routes/api-keys/*`, shell link, access page IDs), tests, [architecture](../../architecture.md), the [initiative index](README.md), and this record.

## Tests

`packages/admin/tests/api-keys.test.ts` (real Better Auth and 2FA): anonymous, user, unenrolled-administrator, and staff denial; capabilities; create/list/revoke/rotate with one-time reveal and no secret in later responses or storage; invalid input; cross-origin rejection; unknown routes; the `api-key`/`create` action requirement. `packages/admin-ui/tests/api-keys.test.ts`: client, actions, safe messages, malformed forms, rendering, escaping, and link visibility.

## Acceptance Criteria

- [x] Admin 2FA is required.
- [x] Create/list/revoke work.
- [x] Rotation works according to policy.
- [x] Secret is shown once only.
- [x] Owner/scopes/expiry are configurable.
- [x] Docs updated.

## Validation

`pnpm test`, `pnpm typecheck` (including svelte-check), `pnpm build`, `admin-ui verify:build`, `pnpm check`, biome, and `git diff --check` pass. No Playwright browser script was added for this page; the forms are covered by render and action tests.

## Known Limitations

Owners are entered as user IDs (no picker). No edit-in-place (rename, rescope): revoke and create, or rotate. Organization owners are not supported.

## Follow-Ups

[PM3.5](phase-05-hardening.md) adds operational hardening and end-to-end integration.

## Completion Notes

Pending implementation and validation.
