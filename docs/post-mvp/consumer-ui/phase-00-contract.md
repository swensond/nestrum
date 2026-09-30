# PM4.0 — Hosted Web Contract

## Status

Complete

## Goal

Document consumer UI ownership, reserved routes, production/development responsibilities, package boundaries, and client/server configuration security.

## Scope

- Create the PM4 index and five bounded phase records.
- Define application-owned Svelte UI, PM1 runtime integration, SPA/static serving, reserved namespaces, helpers, and public configuration filtering.
- Define testing expectations and the boundary between consumer and protected admin surfaces.
- Link the initiative from the post-MVP roadmap, architecture, and documentation index.

## Out of Scope

Svelte package implementation, CLI/build/runtime changes, auth/API client code, route middleware, SSR, asset serving, and new dependencies.

## Architecture Decisions

The consumer product UI belongs to the application; Nestrum hosts its lifecycle. PM4 extends PM1's planned commands. Start with static SPA hosting; do not preclude future SSR. Reserve framework namespaces and never allow SPA fallback to swallow them. Serialize only explicit client-safe configuration. Consumer helpers never expose private admin APIs.

## Implementation

Added the initiative index and PM4.0–PM4.5 phase records. PM4.0 is complete; PM4.1–PM4.5 remain Not Started. No runtime, CLI, Svelte, or auth code changed.

## Public API

Documents planned `web` configuration, integration package, consumer routes, auth/API helpers, reserved namespaces, and `.nestrum/web/*` output. No executable exports or behavior are added.

## Files / Packages Changed

New `docs/post-mvp/consumer-ui/` documents plus updates to `docs/post-mvp.md`, `docs/architecture.md`, and `docs/README.md`. No package changes.

## Tests

Documentation validation only: required files/sections, relative links, and whitespace.

## Acceptance Criteria

- [x] Consumer ownership documented.
- [x] Reserved routes documented.
- [x] Build and dev responsibilities documented.
- [x] Client/server configuration boundary documented.
- [x] Phase records and roadmap links created.

## Validation

Verify all six records, local links, standard sections, and `git diff --check`.

## Known Limitations

Hosted UI is not implemented. Package naming, SvelteKit adapter shape, static output, SSR strategy, proxy ports, and helper APIs require implementation decisions.

## Follow-Ups

[PM4.1](phase-01-web-package.md) creates the Svelte integration package. PM1 runtime commands remain planned dependencies.

## Completion Notes

PM4.0 records the contract without changing current serving behavior.
