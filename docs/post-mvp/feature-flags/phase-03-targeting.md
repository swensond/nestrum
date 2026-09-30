# PM5.3 — Targeting and Deterministic Rollouts

## Status

Complete

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

`FeatureEvaluator` resolves override, subject, organization, percentage, environment, global, then the declared default (the planned order plus a `global` layer between environment and default). Percentage rules use `murmur3("v1\0flag\0stableKey") % 10000` (`hash.ts`, `ROLLOUT_HASH_VERSION`); a subject is inside when `bucket < round(percentage × 100)`. The stable key is `stableId ?? subject.id`; without it (anonymous) rollout and subject layers are skipped. Rule input is validated (scope, target shape and length, boolean `enabled`, percentage 0–100 with at most two decimals). Evaluations return a safe reason (`source`, `target`, `percentage`, `bucket`).

## Public API

`FeatureContext`, `FeatureRule`, `FeatureRuleScope`, `FeatureEvaluation`/`FeatureReason`, `rolloutBucket`, `murmur3`, `validateRuleInput`.

## Files / Packages Changed

`packages/core/src/features/{evaluator,hash,features.types}.ts`, core tests, architecture, roadmap, initiative index, and this record.

## Tests

Core tests cover every precedence layer in order, skipped layers without context, murmur3 reference vectors, bucket range and distribution, deterministic repeats, percentage 0/100 boundaries, monotonic growth when the percentage rises, anonymous stable identifiers, invalid rules and explanation reasons.

## Acceptance Criteria

- [x] Precedence is tested and documented.
- [x] Rollout is deterministic.
- [x] No request-time randomness is used.
- [x] Anonymous evaluation follows the stable-ID rule.
- [x] Docs updated.

## Validation

Run targeting tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, and `git diff --check`.

## Known Limitations

Targeting reads only subject, organization and environment; attribute-based rules are not supported (`attributes` is carried for application code).

## Follow-Ups

[PM5.4](phase-04-runtime.md) integrates the evaluator with InferDI and request context.

## Completion Notes

No `Math.random()` or clock is used in evaluation. Hash and input format are version-tagged.
