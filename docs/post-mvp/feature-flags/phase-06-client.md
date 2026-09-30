# PM5.6 — Consumer UI Exposure

## Status

Complete

## Goal

Expose only explicitly client-visible, server-evaluated feature values to the hosted consumer UI.

## Scope

- Support `exposeToClient: true` flag declarations.
- Evaluate flags server-side using the request context.
- Send only safe boolean values to browser helpers.
- Integrate with PM4 hosted consumer UI and public runtime configuration.
- Keep targeting rules, rollout internals, hidden names, sensitive attributes, and server-only defaults out of bundles/responses.

## Out of Scope

Complete browser targeting engine, client-side authorization, multivariate values, and admin management.

## Architecture Decisions

Depends on [PM5.5](phase-05-admin.md) and PM4 consumer hosting. Server evaluation is authoritative; the browser consumes a filtered snapshot/helper result. Client-visible flags remain informational and never bypass API/resource ABAC.

## Implementation

`exposeToClient: true` flags are evaluated on the server for the request subject and served by the reserved `GET /__nestrum/features` as `{ features: { name: boolean } }` with `Cache-Control: private, no-store` and `Vary: Cookie`; the route is registered only when features are configured and refuses to overlap application routes. `createFeatureClient()` (`@nestrum/web/client`) loads it, exposes `enabled(name)` and a store-compatible `state`, keeps only boolean values, and fails closed. The example consumer app shows `newDashboard: on|off`.

## Public API

`GET /__nestrum/features`, `createFeatureClient`, `FeatureClient`, `FeatureState`, `FEATURES_PATH`, `BoundFeatures.exposed`.

## Files / Packages Changed

`packages/hono/src/runtime/runtime.ts`, `packages/web/src/client/features.ts`, web/hono tests, example web app and browser check, architecture, roadmap, initiative index, and this record.

## Tests

Hono tests assert exposed-only booleans, absence of hidden names, rules, reasons and subject identifiers in the body, cache headers, method rejection and per-subject values; web tests cover the endpoint, credentials, snapshot reads, states and fail-closed behavior. The Playwright consumer check asserts `newDashboard: off` and the exact response, and passes in the project owner's Docker integration run.

## Acceptance Criteria

- [x] Only `exposeToClient` flags appear.
- [x] Browser receives evaluated booleans only.
- [x] Hidden rules never reach client.
- [x] Consumer helper works.
- [x] Docs updated.

## Validation

Run client/filtering tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, `svelte-check-native`, browser checks, and `git diff --check`.

## Known Limitations

Values are informational and can be stale until `load()` runs again; SSR renders with the client default (off) unless the application fetches values itself. Client values never replace server ABAC.

## Follow-Ups

[PM5.7](phase-07-hardening.md) adds dev/test overrides, diagnostics, invalidation, and E2E hardening.

## Completion Notes

The browser never receives targeting rules, rollout internals, hidden flag names or attributes.
