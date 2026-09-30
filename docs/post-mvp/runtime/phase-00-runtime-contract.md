# PM1.0 — Runtime Documentation and Contract

## Status

Complete

## Goal

Document the self-serving runtime before implementation begins. Users define the application; the framework owns development, build, serving, and shutdown.

## Scope

- Record the [complete runtime initiative](README.md), command responsibilities, configuration entry, precedence, and environment behavior.
- Specify portable package boundaries, build output/manifest, production startup, and development regeneration/restart.
- Specify explicit migrations, admin serving/security, health/readiness, and graceful shutdown.
- Create PM1.0–PM1.6 phase records and link the initiative from the roadmap, architecture, and documentation index.

## Out of Scope

Runtime implementation, new packages, dependency changes, executable commands, and changes to the existing example bootstrap.

## Architecture Decisions

`dev` and `serve` own lifecycles; `serve` requires a prior build and never compiles, watches, generates schemas, or migrates. Node listener APIs belong in `@nestrum/runtime-node`; portable contracts belong in `@nestrum/runtime`. Configuration discovers `nestrum.config.ts`, while apps remain explicitly registered. Readiness precedes traffic. Preserve current configure/pre-ready and reverse-cleanup barriers.

The proposed `defineConfig` API must be reconciled with existing application/database CLI contracts during implementation. API examples are targets, not shipped exports. Internal artifact layout and exact manifest compatibility rules remain implementation decisions.

## Implementation

Added the initiative index and seven bounded phase records. Updated the post-MVP roadmap, architecture, and documentation index without changing runtime code. PM1.1–PM1.6 remain Not Started; the initiative definition of done remains unchecked.

## Public API

Documents planned `nestrum dev`, `nestrum build`, and `nestrum serve`, along with runtime adapter and configuration shapes. No new public exports or executable behavior.

## Files / Packages Changed

`docs/post-mvp/runtime/README.md`, `phase-00-runtime-contract.md` through `phase-06-hardening.md`, `docs/post-mvp.md`, `docs/architecture.md`, and `docs/README.md`. No packages changed.

## Tests

Documentation checks only: verify required files, local links, phase statuses/acceptance criteria, and whitespace. No runtime test changes.

## Acceptance Criteria

- [x] Command responsibilities documented.
- [x] Runtime portability boundary documented.
- [x] Production/development behavior documented.
- [x] Migration behavior documented.
- [x] Package boundaries documented.
- [x] Phase documentation reflects the plan.

## Validation

Validate all eight runtime documents, their local Markdown links, roadmap/architecture/index links, and `git diff --check`. Runtime tests/builds are not required for this documentation-only phase.

## Known Limitations

No runtime commands or proposed APIs have been implemented by this phase. Connections, environment defaults, exact adapter input/handle semantics, manifest compatibility, build validation boundaries, and drain behavior must be finalized in their implementation phases.

## Follow-Ups

[PM1.1](phase-01-runtime-adapter.md) defines the portable adapter contract. The remaining MVP atomic object-policy write gate stays independent of this initiative.

## Completion Notes

PM1.0 records the plan and prepares the implementation documents. Completion of documentation does not imply completion of the runtime initiative.
