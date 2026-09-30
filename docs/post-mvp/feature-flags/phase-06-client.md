# PM5.6 — Consumer UI Exposure

## Status

Not Started

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

Planned server-to-client filtering and consumer helper integration. Define hydration/cache behavior so stale values are deterministic and safe. Ensure hidden flags cannot be inferred from generic registries or source maps.

## Public API

Planned `exposeToClient` declaration and consumer evaluated-values helper.

## Files / Packages Changed

Planned web/auth/client integration, server filtering, tests, architecture, initiative index, and this record.

## Tests

Cover exposed-only filtering, evaluated booleans, hidden flags/rules/attributes exclusion, server/client parity, and ABAC remaining server-side.

## Acceptance Criteria

- [ ] Only `exposeToClient` flags appear.
- [ ] Browser receives evaluated booleans only.
- [ ] Hidden rules never reach client.
- [ ] Consumer helper works.
- [ ] Docs updated.

## Validation

Run client/filtering tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, `svelte-check-native`, browser checks, and `git diff --check`.

## Known Limitations

Client values are not an authorization mechanism and may become stale until refreshed according to the documented server-evaluation policy.

## Follow-Ups

[PM5.7](phase-07-hardening.md) adds dev/test overrides, diagnostics, invalidation, and E2E hardening.

## Completion Notes

Pending implementation and validation.
