# PM5.5 — Admin Feature Management

## Status

Not Started

## Goal

Provide protected admin management and explainable feature evaluation.

## Scope

- Add `/admin/features` and `/__admin/features/*`.
- Require Better Auth, admin 2FA, `admin.access`, feature-management ABAC, and same-origin policy.
- Support viewing flags/defaults, global/environment/subject/organization overrides, and rollout percentages.
- Expose evaluation reasoning without leaking sensitive attributes.
- Provide `features.read` and `features.manage` actions and an audit/event seam.

## Out of Scope

Consumer exposure, full audit history, multivariate flags, and application-owned feature pages.

## Architecture Decisions

Depends on [PM5.4](phase-04-runtime.md) and PM2 admin assurance. Feature management is privileged configuration, not ordinary resource CRUD. Admin 2FA and ABAC remain mandatory. Explanations identify the winning rule and safe context, never secrets or hidden policy internals.

## Implementation

Planned metadata-driven admin UI/API, validation of names/targets/percentages, safe reason output, and event emission for changes. Persistent updates invalidate evaluation state deterministically if caching exists.

## Public API

Planned admin routes, actions, override/rollout inputs, and explanation response shape.

## Files / Packages Changed

Planned admin/admin-ui/core integration, event seam, tests, architecture, initiative index, and this record.

## Tests

Cover admin 2FA, ABAC, same-origin, overrides/rollouts, explanations, invalid inputs, audit events, and direct API protection.

## Acceptance Criteria

- [ ] Admin 2FA is required.
- [ ] Feature-management ABAC is required.
- [ ] Overrides are manageable.
- [ ] Rollout is configurable.
- [ ] Evaluation explanations are available.
- [ ] Docs updated.

## Validation

Run admin/API tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, browser checks, and `git diff --check`.

## Known Limitations

Consumer browser exposure and process-local development overrides remain PM5.6/PM5.7.

## Follow-Ups

[PM5.6](phase-06-client.md) filters and serves evaluated client values.

## Completion Notes

Pending implementation and validation.
