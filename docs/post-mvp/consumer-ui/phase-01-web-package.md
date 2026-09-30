# PM4.1 — Consumer Svelte Integration

## Status

Complete

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

- [x] Svelte 5 integration works.
- [x] TypeScript 7 works.
- [x] `svelte-check-native` passes.
- [x] UI remains application-owned.
- [x] Example consumer app builds through the integration seam.
- [x] Docs updated.

## Validation

Run targeted Svelte tests, `svelte-check-native`, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, and `git diff --check`.

## Known Limitations

The package does not yet build into `.nestrum/web` or run under `nestrum dev`.

## Follow-Ups

[PM4.2](phase-02-build.md) integrates production build and serving.

## Completion Notes

Implemented. The package is `@nestrum/web` (chosen over `@nestrum/app-svelte`: it also carries framework-neutral hosting and browser helpers). The stable seam is a thin Nestrum wrapper around the application's **own Vite project** rather than SvelteKit adapter output: the consuming project owns its `vite.config.ts` (Svelte plugin, aliases) and `index.html` entry, and Nestrum resolves `vite` from the web root and drives it. Exports: `@nestrum/web` (server: `resolveWebConfig`, `createWebHost`, route/namespace validation, public-config serialization) and `@nestrum/web/client` (browser helpers, no Node imports). `web: { enabled, root, publicEnv }` is validated by `defineConfig`. `apps/example/src/web` is a representative Svelte 5 SPA (TypeScript 7 workspace compiler, `svelte-check-native` passes via `pnpm --filter @nestrum/example check:web`, part of `pnpm typecheck`). SSR extension point: the runtime consults a `WebUi` handler (`{ handle(request) }`), so an SSR handler could replace the static host without changing the lifecycle.

Validated: `pnpm test`, `pnpm typecheck` (including `svelte-check-native`), `pnpm build`, `verify:build`.
