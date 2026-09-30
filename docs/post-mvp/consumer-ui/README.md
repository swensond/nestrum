# Nestrum Post-MVP Plan 04 — Hosted Consumer Application UI

## Status and navigation

This is the fourth planned post-MVP initiative. PM4.0–PM4.5 are complete (see each phase record for evidence and the open Playwright follow-up). The package is `@nestrum/web`; the consumer UI is the application's own Vite project. PM4 extends the planned `dev`, `build`, and `serve` lifecycle from [Post-MVP Plan 01](../runtime/README.md).

| Phase | Goal | Primary surface | Status |
| --- | --- | --- | --- |
| [PM4.0 — Contract](phase-00-contract.md) | Document ownership, routes, build/dev, and client/server boundaries | docs/core contracts | Complete |
| [PM4.1 — Web package](phase-01-web-package.md) | Add application-owned Svelte integration | `@nestrum/web` | Complete |
| [PM4.2 — Build and serve](phase-02-build.md) | Build and host consumer assets in production | CLI/runtime | Complete |
| [PM4.3 — Dev integration](phase-03-dev.md) | Coordinate backend and consumer dev server | CLI/Vite | Complete |
| [PM4.4 — Auth and API](phase-04-auth-api.md) | Provide consumer session/auth/API helpers | web/auth client | Complete |
| [PM4.5 — Hardening](phase-05-hardening.md) | Secure routing/config/assets and verify E2E | runtime/security | Complete |

## Goal and ownership

Nestrum should host the consuming project's web UI alongside its admin panel and APIs. The consuming project owns pages, layouts, components, styles, UX, and branding. Nestrum owns integration, build/serve orchestration, route protection, safe configuration filtering, and lifecycle hosting; it does not generate the product experience.

Production extends the planned PM1 flow: `nestrum build` builds the consumer UI into `.nestrum/web/*`, and `nestrum serve` hosts it. Development coordinates backend, consumer Svelte, and admin Svelte servers behind one `nestrum dev` command, potentially proxying internally to Vite.

## Package and configuration

`@nestrum/web` provides hosting and browser helpers; the application owns a Vite project (with its own Svelte plugin). Keep the admin integration separate. Configuration:

```ts
export default defineConfig({
  web: {
    enabled: true,
    root: "./src/web",
  },
});
```

`publicEnv`, `basePath`, and `ssr: { entry }` are implemented (see PM4.5's follow-up). The web root remains application-owned and does not introduce automatic app discovery.

## Routes and serving

Reserve `/api/*`, `/admin/*`, `/__admin/*`, and `/__nestrum/*`. Consumer routes are ordinary application routes; collisions fail build with useful diagnostics. Production serves consumer UI at `/`, `/projects`, `/account`, alongside the public API, admin UI/API, and runtime endpoints.

Static/SPA output hosted by Nestrum is the default; SSR is opt-in through `web.ssr`. Serve JavaScript, CSS, images, fonts, favicon, and public assets while preserving hashed output. In SPA mode, unknown ordinary GET routes serve the consumer index; framework namespaces and non-GET/API 404s are never swallowed.

## Auth, API, and configuration safety

Provide consumer helpers for current session, current user, sign-in, sign-out, and auth state. Provide a same-origin public API client that understands session credentials and Nestrum error shapes. These helpers never expose `/__admin/*` or admin-only metadata.

Only explicitly selected client-safe configuration reaches the browser:

```ts
web: {
  publicEnv: {
    analyticsId: env.ANALYTICS_ID,
  },
}
```

Database credentials, Better Auth secrets, API-key hashes, admin metadata, private environment values, and server-only feature rules remain server-only.

## Testing and definition of done

Vitest covers integration/auth/API helpers, reserved route validation, and public config filtering. Playwright covers consumer load, login, API requests, admin separation, collision protection, and production serving.

- [x] Consumer Svelte UI works through the Nestrum lifecycle.
- [x] `nestrum dev` runs it automatically.
- [x] `nestrum build` builds it automatically.
- [x] `nestrum serve` hosts it automatically.
- [x] Better Auth and public API helpers work.
- [x] Admin remains distinct and protected.
- [x] Framework namespaces cannot be shadowed.
- [x] Client-safe/server-only configuration stays separated.
- [x] The application owns its product UI/UX.

Every phase updates documentation and leaves the repository green. See [architecture](../../architecture.md), [post-MVP roadmap](../../post-mvp.md), and [phase requirements](../../phases/README.md#completion-requirements).
