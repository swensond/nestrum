# Phase 13 — Generic Svelte Admin CRUD

## Status

Complete

## Goal

Deliver usable generic list/create/edit/delete without per-resource Svelte code.

## Scope

- Implement ResourceList, ResourceTable, ResourceForm, ResourceCreate, ResourceEdit, ResourceDelete, and FieldRenderer.
- Support string, textarea, number, boolean, enum/select, date, datetime, and readonly widgets.
- Use generated metadata for client behavior while retaining authoritative server validation.
- Handle list, create, edit, delete, and validation feedback through generic routes.

## Out of Scope

Polished visual design, uploads, rich text, bulk actions, and advanced relation pickers.

## Architecture Decisions

The existing four generic routes now use reusable components and SvelteKit server actions. Actions reload authorized metadata on every submission, then call `/__admin` through the same request-scoped Fetch bridge used by the shell. They never access database backends directly or use public routes. Session, same-origin, resource policies, scopes, and composed schemas remain authoritative in the private API. Capability flags only guide the UI and provide an early rejection before forwarding a write.

CRUD forms use ordinary POST submissions and work without JavaScript. With JavaScript, editing a control automatically selects its “Set value” mode and pending buttons prevent repeat submissions. Unchanged update fields are omitted by default; a mode selector also supports explicit omission/defaults and nullable values. Without JavaScript, choose “Set value” explicitly when editing. Empty strings, false, zero, null, and omitted values remain distinct.

Date/instant/datetime-string widgets show and submit UTC. Temporal plain date/time values remain local and acquire missing seconds from browser controls. Bigints stay decimal strings to preserve precision. Arrays use JSON textareas and remain subject to server scalar/array validation. The initial multiline string heuristic covers description/content/notes/body names; Phase 14 subsequently adds explicit widget overrides.

## Implementation

`ResourceList` requests bounded lists and offers maximum sizes of 20, 50, and 100 plus ordering by visible scalar fields. `ResourceTable` shows only visible metadata fields named in `listDisplay`, handles empty results, and links supported scalar IDs safely to the detail route. Hidden presentation fields are never rendered, even if present in backend records.

`ResourceCreate` and `ResourceEdit` compose `ResourceForm` and `FieldRenderer`. Widgets come from field kind, enum values, array shape, required/default/nullable flags, and creatable/updatable/readOnly metadata. Primary keys cannot be edited. Readonly fields render as output and are excluded from payloads. Update-only resources may submit explicit partial changes without retrieving a record; unavailable list/retrieve capabilities do not trigger read requests.

Named `create`, `update`, and `delete` actions recheck current metadata, reject forged/duplicate/unknown inputs, convert form strings to wire values, and forward private POST/PATCH/DELETE requests. Successful writes redirect with status 303 and reload fresh data. Delete requires an explicit confirmation checkbox, rechecked server-side. Client/form conversion checks basic shape; the private backend applies generated and composed schemas and actual ABAC again.

Validation failures retain editable submitted values and modes and attach backend issues to known visible fields. Controls expose labels, `aria-invalid`, and error descriptions. Session loss, denied actions, missing records, malformed responses, and network failures use safe messages without exposing arbitrary backend error text.

## Public API

No resource-specific UI code is required. The Phase 12 host API remains `createAdminShell()` from `@nestrum/admin-ui/node`, supplied as `createHonoRuntime({ application, adminUi })`.

The portable root additionally exports `AdminResourceClient`, `AdminCrudError`, `recordHref`, `recordId`, form conversion/widget helpers, and their record/feedback types. The injected Fetch client exposes `list`, `retrieve`, `create`, `update`, and `delete`, always targeting the private admin API with same-origin credentials and no caching.

Each of the seven generic components is available through a Svelte subpath, for example:

```ts
import ResourceForm from '@nestrum/admin-ui/components/ResourceForm';
import FieldRenderer from '@nestrum/admin-ui/components/FieldRenderer';
```

These imports require a Svelte toolchain. The adapter copies component sources into the built package beside compiled helper modules; Node consumers use the portable or Node entry points. Components consume metadata, records, and optional form feedback; route pages own headings/navigation and action wiring. Root exports remain independent of Svelte component imports.

## Files / Packages Changed

- `packages/admin-ui/src/lib`: private CRUD client, field/form transport, server action/load helpers, and seven generic components; replaces the Phase 12 metadata-only workspace component.
- `packages/admin-ui/src/routes`: list loading, create/edit/delete actions, records, feedback, and redirects across the existing routes.
- `packages/admin-ui/tooling`: component packaging and production CRUD integration fixtures.
- `packages/admin-ui/tests`: generic widget/form/client/action tests and updated shell coverage.
- Phase, architecture, MVP, and overview documentation. No new packages or dependencies.

## Tests

The admin UI project has 45 tests, including all initial widgets, readonly controls, escaped values, hidden table columns, encoded record IDs, scalar and array conversion, UTC/Temporal formats, bigint precision, false/zero preservation, null/default/omitted inputs, duplicate/unknown fields, retained server errors, session/capability checks, confirmation, safe failures, and unavailable read capabilities.

The production build check now performs create/edit/delete through the actual SvelteKit actions, Hono runtime, private admin router, composed Zod schemas, and QuerySets with a controlled in-memory backend. It covers two resources with identical UI code, validation before writes, fresh results/redirects, confirmed deletion, absent/expired/denied sessions, foreign origins, permission revocation, and independent `api: false` exposure, alongside Phase 12 route/session/static checks.

Browser smoke checks with the compiled shell and a disposable API fixture verified list-to-create navigation, retained invalid input and field feedback, successful creation/detail redirect, editing that selects only the changed field, saved data, and basic layout. Real database/browser authentication remains the Phase 16 integration proof.

## Acceptance Criteria

- [x] Generic list works
- [x] Create works
- [x] Edit works
- [x] Delete works
- [x] Adding an ordinary resource needs zero Svelte code
- [x] Vitest component tests cover field rendering
- [x] Documentation is updated

## Validation

```bash
pnpm test
pnpm typecheck
pnpm check
pnpm build
pnpm lint
pnpm --filter @nestrum/admin-ui exec svelte-check-native --tsconfig tsconfig.json --fail-on-warnings
```

Verified: `pnpm check` passed with 343 tests across 16 files, all seven package builds, native Svelte checking with zero errors/warnings, and compiled CRUD integration. `pnpm lint`, `git diff --check`, and the standalone native-check command also passed. Browser creation/validation/edit smoke checks passed with a disposable API fixture.

## Known Limitations

- Lists are bounded first-page views; the backend has no offset/cursor contract yet. Limit/order controls do not claim pagination or total counts.
- IDs equal to `.`, `..`, or an empty string cannot be addressed safely through the existing private path API and are not linked. The UI escapes `new` and leading `~` IDs with a `~` prefix so they do not collide with the create route; other scalar IDs are URL encoded.
- Array editing uses JSON, without advanced relation pickers. Multiline strings use a naming heuristic by default; [Phase 14](phase-14-admin-extensions.md) now adds explicit widget overrides.
- UTC instant widgets have browser Date precision; unchanged edit fields stay omitted to avoid incidental conversion or overwrites. Advanced precision/timezone widgets remain deferred.
- The private backend's existing restriction on object-policy item mutations remains enforced. The UI does not bypass it.
- Auth UI still requires JavaScript for login/logout. CRUD submissions work without JavaScript; editing then requires explicit field mode selection.

## Follow-Ups

Phase 14 provides component/widget overrides and custom actions. Phase 16 exercises real SQL/MongoDB persistence and the browser authentication flow. Cursor pagination, advanced widgets, bulk actions, and relations remain [post-MVP](../post-mvp.md).

## Completion Notes

Phase 13 is complete. Generic list/create/edit/delete, all initial widgets, retained validation feedback, server-authoritative private API forwarding, reusable packaged components, and zero-resource-specific-page behavior are implemented and validated. Phase 14 subsequently implements component overrides and custom actions.
