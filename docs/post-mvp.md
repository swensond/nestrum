# Explicitly deferred work

These features are outside the frozen MVP unless a small supporting abstraction is necessary for an included capability. Record newly deferred work here as implementation proceeds.

## Plan 06 — Enterprise SSO

The [enterprise SSO initiative](post-mvp/sso/README.md) is the sixth post-MVP initiative and is implemented. It adds OIDC and SAML 2.0 single sign-on on Better Auth's official SSO plugin (`@better-auth/sso`), with a prebuilt Svelte admin at `/admin/auth/sso` for managing multiple providers, domains, encrypted secrets and validation, all behind admin 2FA and `sso.*` ABAC actions.

PM6.0–PM6.8 are complete. `defineAuth({ sso: { enabled: true } })` registers the plugin; providers are created and changed only through `application.auth.sso` and the admin (`/__admin/auth/sso/*`, `sso.read`/`create`/`update`/`delete`/`enable`/`disable`/`test`). Client secrets and SAML private keys are sealed at rest and never returned; IdP URLs must be public HTTPS unless the operator declares `trustedIdpOrigins`; disabled providers reject new sign-ins; deletion removes configuration only. Domain verification is opt-in, provisioning options pass through to Better Auth (`resolveUser` needs the auth binding's optional PostgreSQL `transaction` hook), and an SSO login tags the session `authMethod: 'sso'`, reaches ABAC through the SubjectFactory with `ssoProviderId`, and never satisfies admin 2FA. IdP claims never become Nestrum authorization. See [decision 0017](decisions/0017-enterprise-sso.md). Existing applications migrate the new `SsoProvider` table and two `Session` columns. Real PostgreSQL verification (`pnpm --filter @nestrum/example verify:sso`) and a real-browser admin lifecycle for both protocols plus an OIDC browser sign-in (`pnpm --filter @nestrum/example e2e:sso`) pass; the Docker + MongoDB `pnpm test:integration` run, with SSO enabled in the example, was run by the project owner and passes. The remaining MVP atomic object-policy write gate stays open independently.

| Phase | Goal | Status |
| --- | --- | --- |
| [PM6.0](post-mvp/sso/phase-00-contract.md) | Document SSO contract | Complete |
| [PM6.1](post-mvp/sso/phase-01-better-auth-integration.md) | Better Auth SSO plugin integration | Complete |
| [PM6.2](post-mvp/sso/phase-02-provider-registry.md) | Provider registry and secure persistence | Complete |
| [PM6.3](post-mvp/sso/phase-03-oidc.md) | OIDC | Complete |
| [PM6.4](post-mvp/sso/phase-04-saml.md) | SAML 2.0 | Complete |
| [PM6.5](post-mvp/sso/phase-05-admin-backend.md) | Private admin management API | Complete |
| [PM6.6](post-mvp/sso/phase-06-admin-ui.md) | Prebuilt Svelte SSO admin | Complete |
| [PM6.7](post-mvp/sso/phase-07-provisioning.md) | Provisioning and organization/domain mapping | Complete |
| [PM6.8](post-mvp/sso/phase-08-hardening.md) | Diagnostics, testing, hardening | Complete |

Future work: trusting upstream MFA assurance, OAuth2-only providers, single logout, `private_key_jwt`, Better Auth organization-plugin integration, a non-password admin assurance path for SSO-only administrators, and an audit-history product.

## Plan 05 — Feature flags

The [feature-flag initiative](post-mvp/feature-flags/README.md) is the fifth post-MVP initiative and is implemented. It provides typed boolean capability evaluation across backend services, public APIs, admin, and the hosted consumer UI while keeping feature state separate from authorization.

PM5.0–PM5.7 are complete. `defineFeatureFlags` declares typed boolean flags with source defaults; `defineFeatures` (`@nestrum/features`) registers them with an application and persists overrides in Nestrum's `FeatureOverride` Prisma model (or in memory). Evaluation resolves in-process override, subject, organization, deterministic percentage rollout, environment, global, then the default, and never replaces ABAC. Request scopes inject a `features` service; administrators manage overrides at `/admin/features` (`/__admin/features/*`, admin 2FA, `features.read`/`features.manage`) with explanations and an audit seam; `exposeToClient` flags are served as server-evaluated booleans at `/__nestrum/features` and read with `createFeatureClient()`; `withFeatureFlags` and `nestrum dev --feature` provide isolated overrides. See [decision 0016](decisions/0016-feature-flags.md). Existing applications adopting features migrate the new `FeatureOverride` table. Real PostgreSQL verification (`pnpm --filter @nestrum/example verify:features`) passes; the Docker + MongoDB `pnpm test:integration` run, including its feature-flag section and the Playwright consumer check, was run by the project owner and passes. The remaining MVP atomic object-policy write gate stays open independently.

| Phase | Goal | Status |
| --- | --- | --- |
| [PM5.0](post-mvp/feature-flags/phase-00-contract.md) | Document feature-flag contract | Complete |
| [PM5.1](post-mvp/feature-flags/phase-01-registry.md) | Typed registry and evaluator | Complete |
| [PM5.2](post-mvp/feature-flags/phase-02-storage.md) | Persistent override storage | Complete |
| [PM5.3](post-mvp/feature-flags/phase-03-targeting.md) | Targeting and deterministic rollout | Complete |
| [PM5.4](post-mvp/feature-flags/phase-04-runtime.md) | InferDI/request integration | Complete |
| [PM5.5](post-mvp/feature-flags/phase-05-admin.md) | Protected admin management | Complete |
| [PM5.6](post-mvp/feature-flags/phase-06-client.md) | Consumer UI exposure | Complete |
| [PM5.7](post-mvp/feature-flags/phase-07-hardening.md) | Testing, diagnostics, invalidation, audit | Complete |

Future work: multivariate values, attribute-based targeting, declarative resource gating, scheduled changes, cross-process cache invalidation, and audit history.

## Plan 04 — Hosted consumer application UI

The [hosted consumer UI initiative](post-mvp/consumer-ui/README.md) is the fourth planned post-MVP initiative. It extends the planned PM1 `nestrum dev`, `nestrum build`, and `nestrum serve` lifecycle so applications can ship a consumer-facing Svelte UI alongside the public API, admin UI/API, Better Auth, Prisma, and ABAC.

PM4.0–PM4.5 are complete: `web: { enabled, root, publicEnv }` builds the application's Vite/Svelte project into `.nestrum/web` (`nestrum build`), hosts it with SPA fallback that never shadows framework namespaces (`nestrum serve`), proxies Vite with HMR (`nestrum dev`), and ships `@nestrum/web/client` auth/API helpers. Playwright coverage is in the example's integration suite and passes in the project owner's Docker run. Follow-up: `web.basePath` and `web.ssr` (Svelte SSR with hydration) are implemented; the Docker integration run with SSR enabled passes. The consuming project owns product pages, components, UX, and branding. Nestrum owns integration, build/serve/dev coordination, reserved namespaces, and client/server configuration filtering. The remaining MVP atomic object-policy write gate stays open independently.

| Phase | Goal | Status |
| --- | --- | --- |
| [PM4.0](post-mvp/consumer-ui/phase-00-contract.md) | Document hosted web contract | Complete |
| [PM4.1](post-mvp/consumer-ui/phase-01-web-package.md) | Consumer Svelte integration package | Complete |
| [PM4.2](post-mvp/consumer-ui/phase-02-build.md) | Production build and serving | Complete |
| [PM4.3](post-mvp/consumer-ui/phase-03-dev.md) | Development backend/web coordination | Complete |
| [PM4.4](post-mvp/consumer-ui/phase-04-auth-api.md) | Consumer Better Auth and public API helpers | Complete |
| [PM4.5](post-mvp/consumer-ui/phase-05-hardening.md) | Routing, config, assets, and E2E hardening | Complete |

## Plan 03 — First-class API keys

The [first-class API-key initiative](post-mvp/api-keys/README.md) is the third post-MVP initiative and is implemented. It gives resource APIs framework-owned machine authentication built on Better Auth's official `@better-auth/api-key` plugin: one-time-reveal hashed secrets, ownership, scopes, expiry, revocation, per-key rate limits, explicit API-key subjects, and ABAC integration.

PM3.0–PM3.5 are complete. Resources opt in with `api: { auth: ['session', 'api-key'] }`; keys are sent as `X-API-Key`, become `type: 'api-key'` subjects (never sessions), must hold the resource's scope (`<resource>:read` / `<resource>:write` by default) and still pass ABAC. Administrators manage keys at `/admin/api-keys` (`/__admin/api-keys/*`) behind admin 2FA and the `api-key` ABAC actions; see [decision 0015](decisions/0015-api-keys.md). Existing applications must migrate the new `ApiKey` table. Only user-owned keys exist: organization owners need Better Auth's organization plugin and remain future work. The real PostgreSQL verification (`pnpm --filter @nestrum/example verify:api-keys`) passes; the Docker + MongoDB `pnpm test:integration` run, including its real API-key creation, reveal, scoped access, rotation and revocation section, was run by the project owner and passes. The remaining MVP atomic object-policy write gate stays open independently.

| Phase | Goal | Status |
| --- | --- | --- |
| [PM3.0](post-mvp/api-keys/phase-00-contract.md) | Document API-key contract | Complete |
| [PM3.1](post-mvp/api-keys/phase-01-storage.md) | Key generation and secure storage | Complete |
| [PM3.2](post-mvp/api-keys/phase-02-authentication.md) | Request authentication and subjects | Complete |
| [PM3.3](post-mvp/api-keys/phase-03-scopes-abac.md) | Scopes and ABAC integration | Complete |
| [PM3.4](post-mvp/api-keys/phase-04-admin.md) | Protected admin management | Complete |
| [PM3.5](post-mvp/api-keys/phase-05-hardening.md) | Rate limits, rotation, redaction, integration | Complete |

## Plan 02 — Admin 2FA enforcement

The [admin 2FA initiative](post-mvp/admin-2fa/README.md) is the second post-MVP initiative and is implemented. It adds a framework-owned current-session assurance layer to the existing Better Auth session + `admin.access` ABAC + same-origin admin boundary.

PM2.0–PM2.5 are complete: admin 2FA is enforced by default on the admin UI and the private admin API, using Better Auth's `twoFactor` plugin (TOTP, one-time backup codes, account lockout) and framework-owned Svelte setup/challenge/recovery pages. Admin access requires a session that passed the second factor, was created after the user's last update, and is younger than `assuranceTtlSeconds` (default 12 hours); an older session gets `ADMIN_2FA_REQUIRED` (`challenge-required`) and must sign in again. This replaces the plan's independently expiring assurance, because the plugin only verifies at sign-in. The auth contract is now prebaked per provider (`defineAuth({ extend })` was removed), and existing applications must migrate `User.twoFactorEnabled` and the `TwoFactor` table. Roles (`user`/`staff`/`admin`), CLI-created administrators, and admin-managed staff followed in [decision 0014](decisions/0014-roles-and-staff-management.md). The Docker + MongoDB integration suite for the example, which performs real 2FA and staff-elevation flows, was run by the project owner and passes. The remaining MVP atomic object-policy write gate stays open independently.

| Phase | Goal | Status |
| --- | --- | --- |
| [PM2.0](post-mvp/admin-2fa/phase-00-contract.md) | Document admin 2FA contract | Complete |
| [PM2.1](post-mvp/admin-2fa/phase-01-assurance.md) | Session assurance abstraction | Complete |
| [PM2.2](post-mvp/admin-2fa/phase-02-enrollment.md) | TOTP enrollment and recovery | Complete |
| [PM2.3](post-mvp/admin-2fa/phase-03-challenge.md) | Admin challenge enforcement | Complete |
| [PM2.4](post-mvp/admin-2fa/phase-04-admin-ui.md) | Svelte admin 2FA UI | Complete |
| [PM2.5](post-mvp/admin-2fa/phase-05-hardening.md) | Expiry, diagnostics, and E2E hardening | Complete |

## Plan 01 — Self-serving runtime

The [self-serving runtime initiative](post-mvp/runtime/README.md) is the first planned post-MVP initiative. Users define `nestrum.config.ts` and explicit apps; Nestrum owns development, production builds, HTTP startup, admin serving, and shutdown through `nestrum dev`, `nestrum build`, and `nestrum serve`.

PM1.0 documentation and PM1.1 (`@nestrum/runtime` adapter contracts), PM1.2 (`@nestrum/runtime-node`), PM1.3 (`nestrum build`), and PM1.4 (`nestrum serve`) are complete. PM1.5 (`nestrum dev`, without admin HMR) is complete. PM1.6 (health/readiness, signals, drain deadline, process-level verification) is complete: the example application uses the framework-owned lifecycle and its Docker integration run passes. Plan 01 meets its definition of done except admin Vite/HMR development (the admin shell under `dev` is the prebuilt one), which remains a follow-up. `nestrum dev`, `build`, and `serve` are implemented in `@nestrum/cli`. The remaining MVP atomic object-policy write gate stays open independently.

| Phase | Goal | Status |
| --- | --- | --- |
| [PM1.0](post-mvp/runtime/phase-00-runtime-contract.md) | Runtime documentation and contract | Complete |
| [PM1.1](post-mvp/runtime/phase-01-runtime-adapter.md) | Portable `@nestrum/runtime` adapter contracts | Complete |
| [PM1.2](post-mvp/runtime/phase-02-node-runtime.md) | Node HTTP adapter in `@nestrum/runtime-node` | Complete |
| [PM1.3](post-mvp/runtime/phase-03-build.md) | Validated production build and manifest | Complete |
| [PM1.4](post-mvp/runtime/phase-04-serve.md) | Production startup from a prior build | Complete |
| [PM1.5](post-mvp/runtime/phase-05-dev.md) | Generation, watching, restart, and admin development | Complete (no admin HMR) |
| [PM1.6](post-mvp/runtime/phase-06-hardening.md) | Shutdown, health/readiness, and lifecycle integration | Complete |

Node-specific listener APIs stay in the Node adapter, outside core and CLI. Production never silently builds, regenerates schemas, watches, or migrates; development may regenerate and restart but migrations remain explicit. Every phase updates its documentation and leaves the repository green.

## Data and database

- Advanced cross-database orchestration and distributed transactions.
- Mongo collection compression and custom physical collection storage options.
- PostgreSQL extensions, partitioning, and custom physical indexes not represented by Prisma.
- GridFS and blob storage.
- Advanced aggregate APIs; generated Select/Include/Cursor/Aggregate schema families.
- Public select/include and nested writes.

## Framework

- Event bus, jobs, queues, outbox, sagas, and caching. (Feature flags shipped in [Plan 05](post-mvp/feature-flags/README.md).)
- Soft delete framework and automatic audit history.
- Full plugin ecosystem, code generators, and publishing automation.
- Vite/HMR development serving for the Svelte admin (and rebuilding the admin shell with application component registries) under `nestrum dev`; see [Plan 01](post-mvp/runtime/README.md).
- CLI scaffolding remains deferred. Framework-owned development/build/serve commands are scheduled in [Plan 01](post-mvp/runtime/README.md) beyond the MVP database commands.

## Admin

- Polished visual design, custom pages, dashboards/widgets, and full theme system.
- Inline related editing, bulk actions, and advanced search.
- Rich text editors, file uploads, and relation pickers beyond basic needs.
- Cursor/offset admin pagination and advanced precision/timezone widgets. Phase 13 provides bounded list limits, ordering, UTC instant inputs, and local Temporal inputs.

## Runtime and API

- Formal Bun, Deno, and Cloudflare support.
- Provider-specific optimizations outside Node.
- GraphQL, advanced relationship expansion, generated external SDKs, and public arbitrary Prisma expressions.
- Field-level ABAC is excluded from the MVP; any later adoption requires revisiting stable response and admin contracts.
- Organization-owned and service-identity API keys, external (Redis) API-key rate-limit providers, and key grace-period rotation. (API keys shipped in [Plan 03](post-mvp/api-keys/README.md).)
- OAuth2-only enterprise providers and trusting upstream MFA assurance (`acr`/`amr`, `AuthnContext`) for admin 2FA. (OIDC and SAML SSO shipped in [Plan 06](post-mvp/sso/README.md).)
- Social auth providers, non-admin MFA, passkeys/WebAuthn, QR-image enrollment, factor reset and backup-code/disable UI, independently expiring admin assurance, email verification delivery, account linking, and broader Better Auth plugin coverage. (Admin TOTP 2FA shipped in [Plan 02](post-mvp/admin-2fa/README.md).)

## Implementation follow-ups

Phase 4 leaves Decimal, JSON/BSON, binary, composite/embedded fields, arbitrary codec extensions, and complete storage-constraint inference beyond the initial scalar MVP scope. Static generated per-model schema source files are also deferred; runtime families provide the MVP baseline. See [Phase 4](phases/phase-04-zod-generation.md). Typed QuerySet integration shipped in Phase 6; JSON scalar transport shipped in Phase 9.

Phase 9 leaves composite-key HTTP item routes, configurable route aliases/English irregular inflection, advanced pagination/filtering, interactive documentation UI, and complete OpenAPI expression of custom/native validators deferred. Phase 16 now proves application-owned client preparation/cleanup and real Docker database integration. Atomic object-policy mutation support remains required MVP work, not a post-MVP deferral. Scope-based public writes work now; per-object write policies continue to deny.

Phase 16 found that native Mongo AST parameters require model codec hints for ObjectId equality. Its application-owned binding supplies them through public AST rewrite/parameter APIs. Generalize the framework adapter with explicit metadata/codec ownership before promising metadata-free ObjectId/date filtering to other consumers; do not infer codecs from arbitrary strings. The live example and proof remain application-owned.
