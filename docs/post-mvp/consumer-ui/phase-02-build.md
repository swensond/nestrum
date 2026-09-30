# PM4.2 — Production Build and Serve

## Status

Not Started

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

- [ ] Consumer UI is included in production build.
- [ ] Production assets are served.
- [ ] SPA fallback works for ordinary routes.
- [ ] Reserved routes remain protected.
- [ ] Docs updated.

## Validation

Run compiled build/serve tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, and `git diff --check`.

## Known Limitations

Initial target is static SPA hosting. SSR is not required.

## Follow-Ups

[PM4.3](phase-03-dev.md) coordinates the consumer development server and HMR.

## Completion Notes

Pending implementation and validation.
