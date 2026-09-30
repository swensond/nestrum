# PM4.5 — Consumer UI Hardening

## Status

Not Started

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

- [ ] Framework routes cannot be shadowed.
- [ ] Server secrets never reach client config.
- [ ] Production consumer UI works end to end.
- [ ] Admin remains separate and protected.
- [ ] Docs updated.
- [ ] Initiative definition of done passes and PM4 is marked complete.

## Validation

Run security/browser integration, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, `svelte-check-native`, and `git diff --check`. Record evidence before marking Complete.

## Known Limitations

SSR, alternate deployment models, and richer frontend adapters remain future work unless separately planned.

## Follow-Ups

Record SSR, additional frontend runtimes, CDN/deployment adapters, and advanced client configuration after PM4 completion.

## Completion Notes

Pending implementation and validation. PM4 remains incomplete until all phases and definition-of-done items pass.
