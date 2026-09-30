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

Implemented, with one gap. Delivered: namespace collision rejection at build/dev, fallback restricted to ordinary GET/HEAD HTML routes, allowlist-only `publicEnv` (validated string records, HTML-escaped), build-time secret scan, no source maps, asset/cache policy above, and a final route/precedence design (`webUi` only after all framework routes). Playwright coverage lives in `apps/example/tooling/consumer-browser.mjs` (`pnpm --filter @nestrum/example e2e:consumer` against a running server, and called from `pnpm test:integration` after the API/admin checks): consumer load and public config, deep links, immutable assets, framework namespaces returning JSON 404s for browser navigations, the public API client, admin separation, and Better Auth sign-in (including a failed attempt), reload persistence, and sign-out from the Svelte helpers. Verification status: the full Docker + MongoDB `pnpm test:integration`, including these browser checks (sign-in, reload persistence, sign-out), was run by the project owner and passes. Earlier, steps 1–5 were also run in Chromium against a database-free runtime. Anonymous requests to `/__admin/*` return 401 (the admin API authenticates before routing), which the check accepts alongside 404. PM4 is complete for its implemented scope; `basePath` and SSR remain deferred.

Validated: `pnpm test` (658 passing), `pnpm typecheck`, `pnpm build`, `verify:build`, and a real `nestrum build` of the example application including its Svelte UI.

### Follow-up: base path and SSR

`web.basePath` (e.g. `/app`; default the site root) and `web.ssr: { entry }` are implemented. **Base path:** validated (plain segments, no traversal, never starting with a reserved namespace), used as Vite's `base` in build and dev, and enforced by the host: the UI answers only under the prefix (`/app` redirects to `/app/`), so `/` and other paths stay 404, while framework namespaces are unchanged. It is recorded in the manifest. **SSR:** the entry (a module in the web root) exports `render(request, { template, basePath, publicEnv })` returning a `Response` (or `undefined` for 404). `nestrum build` builds the client to `.nestrum/web` and an SSR bundle to `.nestrum/web-server/entry.mjs` — outside the served directory, and excluded from the browser-output secret scan; `serve` imports it and calls it only for HTML GET/HEAD navigations that are not real files, so assets, non-HTML requests, writes, and framework paths never reach it. In `dev`, navigations render through Vite's `ssrLoadModule` and `transformIndexHtml`, so edits to SSR code apply without a backend restart; asset and HMR requests keep proxying. The example application now renders with Svelte (`src/entry-server.ts`) and hydrates (`main.ts`). Evidence: `packages/web/tests/host.test.ts` and `packages/cli/tests/{web,serve,dev}.test.ts` (real Vite builds, servers, and dev sessions with both features); the example's built SSR output was hosted and driven by `consumer-browser.mjs` in Chromium (hydration without page errors, database-free stand-in server). The project owner's Docker integration run with SSR enabled in the example passes, including the server-rendered-markup assertion. One earlier run failed that assertion and a later run passed with no change to the SSR code (only the assertion's failure message changed); the cause of the transient failure was not identified, so treat a recurrence as a real bug. Limits: `basePath` is only exercised by the CLI tests, not by the example or a browser; streaming SSR, per-route data loading, and SSR-aware auth cookies forwarding are not provided (`render` receives the raw `Request`); one SSR entry per application.
