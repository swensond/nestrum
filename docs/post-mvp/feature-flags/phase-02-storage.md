# PM5.2 — Persistent Override Storage

## Status

Not Started

## Goal

Persist Nestrum-owned feature overrides while retaining source defaults as fallback.

## Scope

- Allow applications to select a backing database (`default`, `configuration`, or validated named database).
- Add Nestrum-owned Prisma models for global/environment and future targeting records.
- Read missing/disabled overrides as declared defaults.
- Validate configuration and preserve future subject/organization/rollout fields.

## Out of Scope

Full targeting evaluation, admin management, InferDI, client exposure, caching, and migrations beyond the persistence contract.

## Architecture Decisions

Depends on [PM5.1](phase-01-registry.md). Storage is framework-owned but database selection is explicit. Source defaults remain deployable fallback when storage is empty or unavailable according to the documented failure policy. Do not let persistence turn feature state into authorization.

## Implementation

Planned schema/service for flag overrides, environment, metadata, timestamps, and future targeting dimensions. Integrate existing Prisma contract/migration workflow and avoid application-owned duplicate models.

## Public API

Planned `features.database` configuration and storage service contracts.

## Files / Packages Changed

Planned core/Prisma/config storage, migrations/contracts, tests, architecture, initiative index, and this record.

## Tests

Cover configured database selection, persistence/readback, defaults fallback, invalid config, schema readiness, and future targeting-compatible records.

## Acceptance Criteria

- [ ] Configured database stores overrides.
- [ ] Source defaults remain fallback.
- [ ] Storage supports future targeting records.
- [ ] Docs updated.

## Validation

Run storage/migration tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, applicable compiled checks, and `git diff --check`.

## Known Limitations

Targeting precedence and runtime injection remain PM5.3/PM5.4.

## Follow-Ups

[PM5.3](phase-03-targeting.md) adds contextual overrides and rollouts.

## Completion Notes

Pending implementation and validation.
