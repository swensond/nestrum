# PM4.2 — Production Build and Serve

## Status

Complete

## Goal

Extend `nestrum build` and `nestrum serve` to produce and host the consumer UI.

## Scope

- Build configured consumer UI into `.nestrum/web/*`.
- Include web assets and manifest references with server/admin/generated artifacts.
- Serve static assets and SPA index fallback through Nestrum.
- Preserve API, admin, private admin, and runtime behavior and 404 semantics.
- Preserve hashed asset names and public assets.

## Out of Scope

Development Vite coordination, auth/API helpers, SSR, and final production security hardening.

## Architecture Decisions

Depends on [PM4.1](phase-01-web-package.md) and planned PM1.3/PM1.4 behavior. SPA fallback applies only to ordinary consumer GET routes; framework namespaces and non-GET requests remain framework responses. Web output is private framework implementation detail.

## Implementation

Planned build validation, static output publication, manifest requirements, asset mounting, and route precedence. Route collisions fail build with app/file/namespace diagnostics.

## Public API

Planned `web.enabled`, `web.root`, optional `basePath`, `.nestrum/web/*`, and production route behavior.

## Files / Packages Changed

Planned CLI/build/runtime/web integration, manifest, example app, tests, architecture, initiative index, and this record.

## Tests

Build valid UI, serve root/deep SPA routes/assets, verify framework namespaces, hashed assets/public files, API 404 preservation, and collision failures.

## Acceptance Criteria

- [x] Consumer UI is included in production build.
- [x] Production assets are served.
- [x] SPA fallback works for ordinary routes.
- [x] Reserved routes remain protected.
- [x] Docs updated.

## Validation

Run compiled build/serve tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, and `git diff --check`.

## Known Limitations

Initial target is static SPA hosting. SSR is not required.

## Follow-Ups

[PM4.3](phase-03-dev.md) coordinates the consumer development server and HMR.

## Completion Notes

Implemented. `nestrum build` validates the web root (`index.html`, route collisions), runs the application's Vite build into `.nestrum/web` (hashed `assets/`, no source maps, `public/` files copied), scans the output for server-only values (secret-named variables and credentialed URLs, excluding allowlisted `publicEnv` values) and fails with `BUILD_WEB_LEAK`, and records `web: { directory }` in the manifest (`null` without a UI; manifest version unchanged, `readManifest` verifies `web/index.html`). `nestrum serve` mounts it through `HonoRuntime`'s new `webUi` option, which is consulted only in the not-found path for GET/HEAD: framework and API routes always win, so `/api/*`, `/admin/*`, `/__admin/*`, and `/__nestrum/*` keep their 404s/JSON. Real files are served first (`assets/*` immutable for a year, other files one hour); extensionless routes whose `Accept` allows HTML get `index.html` (`no-cache`) with `web.publicEnv` embedded in an escaped `<script type="application/json" id="__nestrum_config__">`. Missing assets stay 404. Collision diagnostics name the file and namespace (`BUILD_WEB_COLLISION`).

Validated with compiled build/serve tests in `packages/cli/tests/{web,serve}.test.ts`, `pnpm test`, `pnpm typecheck`, `pnpm build`.
