# PM4.1 — Consumer Svelte Integration

## Status

Not Started

## Goal

Create the application-owned Svelte integration package and a representative consumer application.

## Scope

- Choose and create `@nestrum/web` or `@nestrum/app-svelte`.
- Support Svelte 5, SvelteKit, TypeScript 7, Vitest, and `svelte-check-native`.
- Load a configured application web root without taking ownership of product UX.
- Define the minimal build/dev integration seam for later phases.

## Out of Scope

Production serving, full dev orchestration, auth/API helpers, reserved-route enforcement, SSR, and client configuration serialization.

## Architecture Decisions

Depends on [PM4.0](phase-00-contract.md) and planned PM1 runtime/build contracts. Keep admin separate. Application source remains authoritative; Nestrum supplies integration/build hooks rather than generated UX.

## Implementation

Planned package exports, application web-root conventions, and an example consumer app. Resolve whether SvelteKit adapter output or a thin Nestrum wrapper is the stable seam and record future SSR extension points.

## Public API

Planned web configuration, package entry points, and app-root conventions.

## Files / Packages Changed

Planned web package/example app, workspace/Svelte config, tests, architecture, initiative index, and this record.

## Tests

Verify Svelte 5, TypeScript 7, `svelte-check-native`, Vitest, application-owned routes/components, and package build output.

## Acceptance Criteria

- [ ] Svelte 5 integration works.
- [ ] TypeScript 7 works.
- [ ] `svelte-check-native` passes.
- [ ] UI remains application-owned.
- [ ] Example consumer app builds through the integration seam.
- [ ] Docs updated.

## Validation

Run targeted Svelte tests, `svelte-check-native`, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, and `git diff --check`.

## Known Limitations

The package does not yet build into `.nestrum/web` or run under `nestrum dev`.

## Follow-Ups

[PM4.2](phase-02-build.md) integrates production build and serving.

## Completion Notes

Pending implementation and validation.
