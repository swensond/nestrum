# Phase 12 — Prebuilt Svelte Admin Shell

## Status

Complete

## Goal

Build a prebuilt metadata-driven Svelte 5/SvelteKit admin shell.

## Scope

- Use TypeScript 7, Svelte 5, SvelteKit, svelte-check-native, and Vitest.
- Implement generic `/admin`, `/admin/[resource]`, `/admin/[resource]/new`, and `/admin/[resource]/[id]` routes.
- Drive navigation entirely from admin API metadata.
- Provide shell/loading/error/session boundary behavior needed for generic routes.

## Out of Scope

Resource-specific Svelte page generation, generic CRUD implementation (Phase 13), and polished design.

## Architecture Decisions

The package is `@nestrum/admin-ui` in `packages/admin-ui`; the name describes its role rather than its framework. It contains one prebuilt SvelteKit application mounted at `/admin`, independent of resource registrations. `/__admin` remains the private API boundary.

The Node entry point loads compiled SvelteKit server and client artifacts. Hono supplies request-scoped internal Fetch dispatch; SvelteKit forwards the incoming cookie and origin headers only to same-origin private admin requests. Metadata requests therefore pass through the existing runtime, session, origin, and ABAC gates. Neither the shell nor its route loaders bypass the backend. HTML and route data use `private, no-store`; immutable client assets may be cached publicly.

TypeScript 7.0.2 compiles package exports and powers `svelte-check-native` 1.8.0. SvelteKit 2.70.3 still requires the JavaScript TypeScript parser API for route-type generation, which TypeScript 7 does not expose. An isolated TypeScript 6.0.3 dev dependency supplies that parser to SvelteKit; builds explicitly invoke the workspace TypeScript 7 compiler, and the native checker discovers the workspace TypeScript 7 binary. The generated route types remain fully inferred. Svelte 5.57.1 and Vite 8.3.1 are pinned.

## Implementation

At Phase 12 completion, the root layout loads validated metadata for each route navigation and invalidates it after session changes. Navigation, labels, field descriptions, create links, and route availability derive from that metadata. The shell provides overview, generic resource, new-record, and record-detail workspaces. SvelteKit canonicalizes the overview URL to `/admin/`.

Loading hides the previous navigation and protected content. Missing or expired sessions show an email/password sign-in form; denied access and unavailable metadata show safe messages with retry. Sign-in and sign-out use the framework-owned `/api/auth` endpoints and refresh the server layout. Unknown resources and unavailable operations return a generic 404 after successful metadata discovery. Metadata capabilities guide presentation; backend authorization remains authoritative.

The metadata client validates response shape, field kinds, unique identities/slugs, and safe route slugs with Zod. It does not cache across requests or sessions. Response errors, malformed JSON, and network failures do not expose backend details. The original generic workspaces displayed metadata only and issued no record CRUD requests. Phase 13 now replaces them with CRUD components and actions.

Hono reserves `/admin` and `/admin/*` when `adminUi` is configured, requires a private admin backend, and rejects overlapping application routes. The public `runtime.fetch` readiness guard now rejects traffic before Hono routing, preventing an early host request from freezing its matcher before framework routes are registered. Applications must still register their manual routes before startup and use `runtime.fetch` as the host entry point.

## Public API

```ts
import { createAdminShell } from '@nestrum/admin-ui/node';
import { createHonoRuntime } from '@nestrum/hono';

// application includes auth, admin registrations, model backends, and policies.
const runtime = createHonoRuntime({
    application,
    adminUi: await createAdminShell()
});
await runtime.start();
// Pass runtime.fetch to the application's Fetch-compatible HTTP host.
```

Build the workspace before importing the Node entry point. The compiled shell and assets ship in the package's `dist` directory. Hono depends on the small `AdminUi` Fetch-handler contract, not on Svelte or the UI package.

The portable root export provides `AdminMetadataClient`, `AdminMetadataError`, `ADMIN_METADATA_SCHEMA`, `loadAdminState`, `resourceHref`, `selectWorkspace`, and their state/workspace types. `AdminMetadataClient` accepts an injected Fetch implementation; its default uses browser-relative `/__admin/resources`.

## Files / Packages Changed

- `packages/admin-ui`: SvelteKit shell, generic route loaders/components, metadata client, Fetch adapter, Node host handler, and tests.
- `packages/hono`: optional UI mount contract, namespace conflict checks, readiness guard, and configuration test.
- Root workspace: package lock, native Svelte checking, Vitest project, built integration validation, and narrow Biome overrides for template references.
- Documentation: package naming, current architecture, usage, phase status, and validation.

## Tests

Seventeen shell tests cover one/two-resource navigation, dynamic metadata, request credentials and caching, malformed/duplicate/unsafe metadata, session/error/loading boundaries, label escaping, generic routes, and capability presentation.

The production build verification mounts the actual prebuilt server through Hono. It checks early-request readiness, all four routes, dynamic resource visibility, unavailable resources, route-data caching, missing/expired/forged sessions, denied access, forwarded foreign origins, concurrent session isolation, static JS/HEAD/cache behavior, traversal rejection, and, at Phase 12 completion, absence of CRUD calls. Phase 13 extends the production check to actual CRUD. It also rejects exact, wildcard, and catch-all mount conflicts. A runtime unit test rejects a shell without a configured private backend.

## Acceptance Criteria

- [x] Svelte admin builds with TypeScript 7
- [x] svelte-check-native passes
- [x] Navigation is metadata-driven
- [x] Adding a second admin resource updates navigation automatically
- [x] No resource-specific page is required
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

Verified: `pnpm check` passed with 315 tests across 15 files, all seven package builds, native Svelte checking with zero errors/warnings, and the compiled shell integration check. `pnpm lint`, `git diff --check`, and the standalone native-check command also passed. `svelte-check-native --debug-paths` confirms the TypeScript 7.0.2 native binary.

## Known Limitations

- At Phase 12 completion, generic routes were metadata workspaces. Phase 13 now implements list/create/edit/delete forms and record operations.
- This adapter targets Node and serves prebuilt files from disk. The shell has a fixed `/admin` base; alternate bases and other runtimes are deferred.
- Login/logout require JavaScript and use the framework-owned email/password flow. Browser automation of the live Better Auth cookie exchange remains an integration follow-up; shell rendering and forwarding use controlled session fixtures here.
- `vite dev` runs the UI alone. Applications using it must provide a same-origin proxy to their runtime for `/__admin` and `/api/auth`; the production mount handles internal metadata dispatch itself.
- SvelteKit's parser compatibility dependency remains until it supports TypeScript 7's compiler interface. The native checker, not Biome's partial Svelte parser, validates template references.

## Follow-Ups

Phase 13 adds generic CRUD to these metadata-driven workspaces. Phase 14 adds overrides and custom action handlers. Phase 16 should exercise real authentication and browser navigation alongside the full application. These are existing bounded phase scopes, not additional MVP features.

## Completion Notes

Phase 12 is complete. The prebuilt shell, metadata-driven navigation and generic routes, session/loading/error boundaries, Hono integration, and native TypeScript 7 checking are implemented and validated. Generic record CRUD remains Phase 13. The only tooling compatibility exception is SvelteKit’s isolated TypeScript 6 parser dependency, documented above.

Current integration evidence (2026-09-30): [Phase 16](phase-16-integration.md) now verifies real Docker PostgreSQL/Mongo contracts, migrations, resources, auth, admin forms/browser flows, and shutdown. Earlier phase-specific fixture results remain historical evidence. Atomic object-policy writes still deny and remain an unmet required MVP follow-up.
