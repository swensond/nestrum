# PM5.3 — Targeting and Deterministic Rollouts

## Status

Not Started

## Goal

Implement environment, subject, organization, and deterministic percentage targeting with documented precedence.

## Scope

- Add global/environment, subject, organization, and percentage overrides.
- Implement subject → organization → percentage → environment → default precedence, or document a justified final order.
- Hash flag key + stable subject key into a deterministic bucket.
- Support anonymous evaluation only with an application-provided stable identifier.

## Out of Scope

Multivariate flags, InferDI/request integration, admin UI, client evaluation, and random per-request assignment.

## Architecture Decisions

Depends on [PM5.2](phase-02-storage.md). Never use `Math.random()` per request. Stable subject/anonymous keys and hash algorithm/version must be documented so configuration changes, not process randomness, determine rollout movement. Missing context skips inapplicable targeting safely.

## Implementation

Planned evaluator targeting records, bucket calculation, precedence explanation data, and validation for percentages/bounds. Keep scope/authorization separate from targeting.

## Public API

Planned `FeatureContext` with optional subject, organizationId, environment, and attributes; targeting/rollout configuration and evaluation explanation shape.

## Files / Packages Changed

Planned evaluator/storage/core integration, tests, architecture, initiative index, and this record.

## Tests

Cover every precedence layer, deterministic repeated buckets, percentage boundaries, subject/organization changes, anonymous context, invalid percentages, and explanation reasons.

## Acceptance Criteria

- [ ] Precedence is tested and documented.
- [ ] Rollout is deterministic.
- [ ] No request-time randomness is used.
- [ ] Anonymous evaluation follows the stable-ID rule.
- [ ] Docs updated.

## Validation

Run targeting tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, and `git diff --check`.

## Known Limitations

Evaluation is not yet injected into request/services and admin cannot manage targeting.

## Follow-Ups

[PM5.4](phase-04-runtime.md) integrates the evaluator with InferDI and request context.

## Completion Notes

Pending implementation and validation.
