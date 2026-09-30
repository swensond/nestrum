# PM5.5 — Admin Feature Management

## Status

Complete

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

`registerFeatureRoutes` (`packages/admin/src/feature-routes.ts`) adds, only when features are configured: `GET /__admin/features` (declared flags, defaults, exposure, overrides), `PUT /__admin/features/:flag/rules`, `DELETE /__admin/features/:flag/rules?scope=&target=`, `POST /__admin/features/:flag/explain` and `GET /__admin/features/capabilities`. They sit behind the complete admin boundary (same origin, session, `admin.access`, 2FA) and then need the `features` ABAC actions `read` (staff and admin) or `manage` (admin only), provided by `roleBasedAdminPolicies()`; writes go through the manager, invalidate evaluation state and emit audit events carrying the acting subject. Explanations accept only `subjectId`, `organizationId` and `environment` and return the winning source and target. The `/admin/features` Svelte page (`packages/admin-ui`) lists flags, overrides and the rollout form, shows management controls only with `manage`, and maps every failure to a fixed message.

## Public API

`FEATURE_IDENTITY`, `FEATURE_ACTIONS`, `FeatureAction`, admin routes above, `FeatureAdminClient`, layout `canViewFeatures`.

## Files / Packages Changed

`packages/admin/src/{feature-routes,policies,router,index}.ts`, `packages/admin-ui/src/lib/features.server.ts`, `packages/admin-ui/src/routes/features/*`, shell/layout, admin and admin-ui tests, architecture, roadmap, initiative index, and this record.

## Tests

`packages/admin/tests/features.test.ts` (real Better Auth sessions and TOTP): anonymous/user/unenrolled/staff denial, staff read-only, listing, every override scope, explanations, audit events with actor, invalid input, unknown flags, wrong methods, same-origin rejection, absent routes when unconfigured. `packages/admin-ui/tests/features.test.ts`: client, layout link, form validation, fixed error messages, page rendering with and without `manage`.

## Acceptance Criteria

- [x] Admin 2FA is required.
- [x] Feature-management ABAC is required.
- [x] Overrides are manageable.
- [x] Rollout is configurable.
- [x] Evaluation explanations are available.
- [x] Docs updated.

## Validation

Run admin/API tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, browser checks, and `git diff --check`.

## Known Limitations

The consumer surface and dev overrides are PM5.6/PM5.7. The Playwright admin flow is part of the Docker integration run, not run in this session.

## Follow-Ups

[PM5.6](phase-06-client.md) filters and serves evaluated client values.

## Completion Notes

Feature management is privileged configuration, not ordinary resource CRUD.
