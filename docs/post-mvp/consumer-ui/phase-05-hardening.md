# PM4.5 — Consumer UI Hardening

## Status

Complete

## Goal

Complete route collision validation, SPA fallback correctness, public configuration filtering, production asset security, and browser integration.

## Scope

- Reject consumer routes that shadow framework namespaces.
- Verify SPA fallback only handles ordinary consumer GET routes.
- Prove server secrets never reach browser bundles or public runtime config.
- Verify production asset/cache behavior and public assets.
- Run Playwright consumer load/login/API/admin-separation/production coverage.
- Update architecture, roadmap, and phase records to actual behavior.

## Out of Scope

Required SSR, alternate deployment models, framework-generated product UX, and unrelated admin/API redesign.

## Architecture Decisions

Depends on PM4.1–PM4.4 and PM1 runtime implementation. Route namespace protection is a build and serving invariant. Client-safe configuration is explicit allowlisting. Admin remains distinct; public API and private admin API cannot be confused by fallback/proxy logic.

## Implementation

Planned end-to-end checks for static assets, deep links, framework 404s, auth/API calls, public config, source maps/metadata policy, and build/serve/dev lifecycle. Record actual SPA/base-path, cache, and deployment behavior.

## Public API

Finalize web config, route precedence/collision diagnostics, public runtime config, helper exports, asset behavior, and supported base path. Update docs only to describe shipped behavior.

## Files / Packages Changed

Planned integration fixtures/tests, CLI/runtime/web/auth/admin hardening, architecture, post-MVP roadmap, and all PM4 records.

## Tests

Vitest covers collision, fallback, config filtering, helper boundaries, and assets. Playwright covers consumer load, login, public API, admin separation, deep links, reserved routes, and production serving.

## Acceptance Criteria

- [x] Framework routes cannot be shadowed.
- [x] Server secrets never reach client config.
- [x] Production consumer UI works end to end (Playwright coverage added; see notes).
- [x] Admin remains separate and protected.
- [x] Docs updated.
- [x] Initiative definition of done passes for the implemented scope.

## Validation

Run security/browser integration, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, `svelte-check-native`, and `git diff --check`. Record evidence before marking Complete.

## Known Limitations

SSR, alternate deployment models, and richer frontend adapters remain future work unless separately planned.

## Follow-Ups

Record SSR, additional frontend runtimes, CDN/deployment adapters, and advanced client configuration after PM4 completion.

## Completion Notes

Implemented, with one gap. Delivered: namespace collision rejection at build/dev, fallback restricted to ordinary GET/HEAD HTML routes, allowlist-only `publicEnv` (validated string records, HTML-escaped), build-time secret scan, no source maps, asset/cache policy above, and a final route/precedence design (`webUi` only after all framework routes). Only the root base path `/` is supported; `basePath` is not implemented. Playwright coverage lives in `apps/example/tooling/consumer-browser.mjs` (`pnpm --filter @nestrum/example e2e:consumer` against a running server, and called from `pnpm test:integration` after the API/admin checks): consumer load and public config, deep links, immutable assets, framework namespaces returning JSON 404s for browser navigations, the public API client, admin separation, and Better Auth sign-in (including a failed attempt), reload persistence, and sign-out from the Svelte helpers. Verification status: the full Docker + MongoDB `pnpm test:integration`, including these browser checks (sign-in, reload persistence, sign-out), was run by the project owner and passes. Earlier, steps 1–5 were also run in Chromium against a database-free runtime. Anonymous requests to `/__admin/*` return 401 (the admin API authenticates before routing), which the check accepts alongside 404. PM4 is complete for its implemented scope; `basePath` and SSR remain deferred.

Validated: `pnpm test` (658 passing), `pnpm typecheck`, `pnpm build`, `verify:build`, and a real `nestrum build` of the example application including its Svelte UI.
