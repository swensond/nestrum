# Explicitly deferred work

These features are outside the frozen MVP unless a small supporting abstraction is necessary for an included capability. Record newly deferred work here as implementation proceeds.

## Plan 05 — Feature flags

The [feature-flag initiative](post-mvp/feature-flags/README.md) is the fifth planned post-MVP initiative. It provides typed boolean capability evaluation across backend services, public APIs, admin, and the hosted consumer UI while keeping feature state separate from authorization.

PM5.0 documentation is complete. PM5.1–PM5.7 are Not Started; feature flags are not currently evaluated by the runtime. Source defaults, Nestrum-owned persistence, subject/organization targeting, deterministic rollouts, InferDI integration, protected admin management, explicit client exposure, test/dev overrides, and an audit seam are planned. The remaining MVP atomic object-policy write gate stays open independently.

| Phase | Goal | Status |
| --- | --- | --- |
| [PM5.0](post-mvp/feature-flags/phase-00-contract.md) | Document feature-flag contract | Complete |
| [PM5.1](post-mvp/feature-flags/phase-01-registry.md) | Typed registry and evaluator | Not Started |
| [PM5.2](post-mvp/feature-flags/phase-02-storage.md) | Persistent override storage | Not Started |
| [PM5.3](post-mvp/feature-flags/phase-03-targeting.md) | Targeting and deterministic rollout | Not Started |
| [PM5.4](post-mvp/feature-flags/phase-04-runtime.md) | InferDI/request integration | Not Started |
| [PM5.5](post-mvp/feature-flags/phase-05-admin.md) | Protected admin management | Not Started |
| [PM5.6](post-mvp/feature-flags/phase-06-client.md) | Consumer UI exposure | Not Started |
| [PM5.7](post-mvp/feature-flags/phase-07-hardening.md) | Testing, diagnostics, invalidation, audit | Not Started |

## Plan 04 — Hosted consumer application UI

The [hosted consumer UI initiative](post-mvp/consumer-ui/README.md) is the fourth planned post-MVP initiative. It extends the planned PM1 `nestrum dev`, `nestrum build`, and `nestrum serve` lifecycle so applications can ship a consumer-facing Svelte UI alongside the public API, admin UI/API, Better Auth, Prisma, and ABAC.

PM4.0 documentation is complete. PM4.1–PM4.5 are Not Started; consumer UI hosting is not currently implemented. The consuming project owns product pages, components, UX, and branding. Nestrum owns integration, build/serve/dev coordination, reserved namespaces, and client/server configuration filtering. The remaining MVP atomic object-policy write gate stays open independently.

| Phase | Goal | Status |
| --- | --- | --- |
| [PM4.0](post-mvp/consumer-ui/phase-00-contract.md) | Document hosted web contract | Complete |
| [PM4.1](post-mvp/consumer-ui/phase-01-web-package.md) | Consumer Svelte integration package | Not Started |
| [PM4.2](post-mvp/consumer-ui/phase-02-build.md) | Production build and serving | Not Started |
| [PM4.3](post-mvp/consumer-ui/phase-03-dev.md) | Development backend/web coordination | Not Started |
| [PM4.4](post-mvp/consumer-ui/phase-04-auth-api.md) | Consumer Better Auth and public API helpers | Not Started |
| [PM4.5](post-mvp/consumer-ui/phase-05-hardening.md) | Routing, config, assets, and E2E hardening | Not Started |

## Plan 03 — First-class API keys

The [first-class API-key initiative](post-mvp/api-keys/README.md) is the third planned post-MVP initiative. It gives resource APIs framework-owned machine authentication with one-time-reveal hashed secrets, ownership, scopes, expiry, revocation, rate-limit metadata, explicit API-key subjects, and ABAC integration.

PM3.0 documentation is complete. PM3.1–PM3.5 are Not Started; API keys are not currently accepted by the runtime. Key management depends on the default-required admin 2FA boundary from [Plan 02](post-mvp/admin-2fa/README.md). The remaining MVP atomic object-policy write gate stays open independently.

| Phase | Goal | Status |
| --- | --- | --- |
| [PM3.0](post-mvp/api-keys/phase-00-contract.md) | Document API-key contract | Complete |
| [PM3.1](post-mvp/api-keys/phase-01-storage.md) | Key generation and secure storage | Not Started |
| [PM3.2](post-mvp/api-keys/phase-02-authentication.md) | Request authentication and subjects | Not Started |
| [PM3.3](post-mvp/api-keys/phase-03-scopes-abac.md) | Scopes and ABAC integration | Not Started |
| [PM3.4](post-mvp/api-keys/phase-04-admin.md) | Protected admin management | Not Started |
| [PM3.5](post-mvp/api-keys/phase-05-hardening.md) | Rate limits, rotation, redaction, integration | Not Started |

## Plan 02 — Admin 2FA enforcement

The [admin 2FA initiative](post-mvp/admin-2fa/README.md) is the second post-MVP initiative and is implemented. It adds a framework-owned current-session assurance layer to the existing Better Auth session + `admin.access` ABAC + same-origin admin boundary.

PM2.0–PM2.5 are complete: admin 2FA is enforced by default on the admin UI and the private admin API, using Better Auth's `twoFactor` plugin (TOTP, one-time backup codes, account lockout) and framework-owned Svelte setup/challenge/recovery pages. Admin access requires a session that passed the second factor, was created after the user's last update, and is younger than `assuranceTtlSeconds` (default 12 hours); an older session gets `ADMIN_2FA_REQUIRED` (`challenge-required`) and must sign in again. This replaces the plan's independently expiring assurance, because the plugin only verifies at sign-in. The auth contract is now prebaked per provider (`defineAuth({ extend })` was removed), and existing applications must migrate `User.twoFactorEnabled` and the `TwoFactor` table. The Docker integration run of the example, which now performs a real 2FA flow, is owned by the project owner and was not executed during implementation. The remaining MVP atomic object-policy write gate stays open independently.

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

- Event bus, jobs, queues, outbox, sagas, caching, and feature flags.
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
- Social auth providers, non-admin MFA, passkeys/WebAuthn, QR-image enrollment, factor reset and backup-code/disable UI, independently expiring admin assurance, email verification delivery, account linking, and broader Better Auth plugin coverage. (Admin TOTP 2FA shipped in [Plan 02](post-mvp/admin-2fa/README.md).)

## Implementation follow-ups

Phase 4 leaves Decimal, JSON/BSON, binary, composite/embedded fields, arbitrary codec extensions, and complete storage-constraint inference beyond the initial scalar MVP scope. Static generated per-model schema source files are also deferred; runtime families provide the MVP baseline. See [Phase 4](phases/phase-04-zod-generation.md). Typed QuerySet integration shipped in Phase 6; JSON scalar transport shipped in Phase 9.

Phase 9 leaves composite-key HTTP item routes, configurable route aliases/English irregular inflection, advanced pagination/filtering, interactive documentation UI, and complete OpenAPI expression of custom/native validators deferred. Phase 16 now proves application-owned client preparation/cleanup and real Docker database integration. Atomic object-policy mutation support remains required MVP work, not a post-MVP deferral. Scope-based public writes work now; per-object write policies continue to deny.

Phase 16 found that native Mongo AST parameters require model codec hints for ObjectId equality. Its application-owned binding supplies them through public AST rewrite/parameter APIs. Generalize the framework adapter with explicit metadata/codec ownership before promising metadata-free ObjectId/date filtering to other consumers; do not infer codecs from arbitrary strings. The live example and proof remain application-owned.
