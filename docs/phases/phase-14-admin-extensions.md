# Phase 14 — Admin Extensibility and Arbitrary Actions

## Status

Complete

## Goal

Add admin overrides, custom components, and ABAC-backed arbitrary actions.

## Scope

- Extend admin.register with listDisplay, field widget overrides, and actions.
- Authorize each custom action using its ordinary resource ABAC action name before handler execution.
- Implement a plugin/slot component registry such as adminComponents.register(widget, component).
- Design contribution seams for apps, resources, DI providers, admin components, CLI commands, and database extensions.

## Out of Scope

Full plugin ecosystem, custom admin pages, dashboards, and bulk actions.

## Architecture Decisions

Custom actions use the existing private session/origin boundary and ordinary resource ABAC names. The target read intersects read and action scopes before object checks/handler execution. Handler QuerySets retain their target key and independently enforce action operation grants. Trusted predicates remain independent of caller Where transformations.

Custom widgets register in an explicit sealed build entry shared by SSR and browser bundles, with Svelte context or direct reusable-component injection. Metadata carries safe names, never component code. This requires rebuilding the shell for widget changes. See [ADR 0012](../decisions/0012-admin-extension-boundaries.md), [architecture](../architecture.md), and [contribution seams](../extension-seams.md).

## Implementation

Admin field configuration supports built-in/custom widget names. Action configuration supports labels, optional asynchronous Zod input validation, and awaited handlers. Registration snapshots configuration and rejects unsafe names or invalid schemas/handlers. Metadata exposes names/labels and field overrides without executable configuration.

Known item action requests validate JSON object input, require live session/admin access and resource read/action grants, intersect collection scopes, and apply the action's object decision before execution. Handler contexts provide trusted attributes, a copied readonly record, and an action-bound target QuerySet. Undefined results return 204; other results return encoded `{ result }`. Metadata-only configurations preserve the earlier 501 seam.

The generic detail page renders native POST action forms with JSON input and safe retained failure feedback. Server actions reload authorized metadata, reject forged/invalid submissions, forward through the private API, and redirect to fresh data. FieldRenderer resolves custom components without resource-specific pages; readonly controls remain authoritative for presentation. The default build has no custom components, while NESTRUM_ADMIN_COMPONENTS selects an app entry for both bundles.

App/resource/DI/admin contribution ownership, conflicts, and lifecycle are documented. Future CLI/provider descriptor rules are designed without introducing a general plugin loader or claiming those APIs exist.

## Public API

```ts
admin.register(Project, {
    listDisplay: ['id', 'name'],
    fields: { metadata: { widget: 'json-editor' } },
    actions: {
        archive: {
            label: 'Archive',
            async handler({ objects }) {
                await objects.update({ status: 'archived' });
            }
        }
    }
});
```

The resource policy must grant read and archive, with archive `operations: ['update']` for this handler. Register UI components in a separate browser-safe module with `createAdminComponentRegistry().register('json-editor', JsonEditorField).seal()` and export that registry as default. Build with an absolute NESTRUM_ADMIN_COMPONENTS module path. See [extension usage](../admin-extensions.md) for the full input/handler/widget contract.

`@nestrum/admin` exports AdminActionContext; `@nestrum/admin-ui` exports AdminComponentRegistry, createAdminComponentRegistry, AdminWidgetProps, and AdminWidget. Reusable forms accept optional registries; the new ResourceActions component has a package subpath. AdminResourceClient.action forwards arbitrary known actions through the private API.

## Files / Packages Changed

- `packages/core`: admin configuration/context types and trusted scope intersection on QuerySets.
- `packages/admin`: validated registration, widget metadata, input parsing, authorization, and handler dispatch.
- `packages/admin-ui`: registry/build entry, component injection, native action forms, private client/server forwarding, tests, and production integration checks.
- `docs`: usage, contribution design, ADR, architecture, progress indexes, and this completion record. No new package or dependency.

## Tests

35 admin tests cover the existing private boundary plus handler execution, known metadata without code/schema leakage, action operation/scoped writes, global/object/session/unknown/out-of-scope denial without handler execution, asynchronous transformed input, native result encoding, invalid registration, and trusted predicates under hostile Where transformations.

55 admin UI tests cover the existing shell/CRUD plus custom registry rendering/isolation/sealing/collisions, readonly precedence, built-in overrides, escaped action forms, fresh metadata dispatch, invalid input/unknown action rejection, safe retained feedback, and encoded action/record URLs. The full workspace has 361 tests across 17 files.

Compiled shell integration checks execute real SvelteKit form actions through Hono, the private admin router, Zod, and QuerySets with a controlled backend. They cover authorized action mutation/redirect, denied and revoked actions, live sessions/origins, and the app-supplied custom widget build alongside prior CRUD/static/isolation checks.

## Acceptance Criteria

- [x] Custom field widgets register
- [x] Custom resource actions register
- [x] Custom actions obey ABAC
- [x] Admin internals need no editing
- [x] Documentation is updated

## Validation

```bash
pnpm test
pnpm typecheck
pnpm check
pnpm build
pnpm --filter @nestrum/admin-ui exec svelte-check-native
```

Passed:

- `pnpm check`: 361 tests/17 files, strict typecheck, native Svelte checker with zero errors/warnings, all seven package builds, and compiled shell integration.
- App-entry build and production verification using NESTRUM_ADMIN_COMPONENTS pointed at `packages/admin-ui/tests/admin-components.ts`: custom widget rendered in the compiled generic form; action/CRUD/session/origin checks passed. Final default build restored and verified by pnpm check.
- `git diff --check` and formatting checks for changed TypeScript/config/tooling files.

## Known Limitations

Widget registration is build-time; runtime widget loading and a general plugin ecosystem are absent. Custom widgets own native control/accessibility rendering; generic conversion and backend schemas remain authoritative. Unknown widget names fall back to inference. Actions use JSON input forms, without schema-driven controls or result presentation. Discovery remains advisory and input-dependent policies may hide actions. Check-then-handler execution is not automatically transactional; object-policy QuerySet writes remain fail-closed under the existing restriction. No bulk actions, custom pages, or dashboards were added. Live SQL/MongoDB and browser authentication proof remain Phase 16.

## Follow-Ups

Phase 15 implements the public database CLI and lifecycle hardening using the documented contribution rules. Phase 16 proves live provider/browser behavior. Rich widgets, bulk actions, dashboards, and full plugin discovery remain [post-MVP](../post-mvp.md).

## Completion Notes

Phase 14 is complete. Custom widgets and authorized per-record handlers extend the generic admin without editing its internal pages. Contribution seams are designed with clear implemented/planned boundaries; no broader plugin ecosystem was introduced.

Current integration evidence (2026-09-30): [Phase 16](phase-16-integration.md) now verifies real Docker PostgreSQL/Mongo contracts, migrations, resources, auth, admin forms/browser flows, and shutdown. Earlier phase-specific fixture results remain historical evidence. Atomic object-policy writes still deny and remain an unmet required MVP follow-up.
