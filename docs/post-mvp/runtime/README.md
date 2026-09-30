# Nestrum Post-MVP Plan 01 — Self-Serving Runtime

## Status and navigation

This is the first post-MVP initiative. PM1.0 records the runtime contract; PM1.1–PM1.3 are complete; PM1.4–PM1.6 are not started. Commands, packages, configuration APIs, and build artifacts described below are planned unless a phase explicitly records implementation evidence. This initiative does not close the remaining MVP gate for atomic object-policy writes.

| Phase | Goal | Primary surface | Status |
| --- | --- | --- | --- |
| [PM1.0 — Runtime documentation and contract](phase-00-runtime-contract.md) | Document the self-serving runtime before implementation | docs/core contracts | Complete |
| [PM1.1 — Runtime adapter abstraction](phase-01-runtime-adapter.md) | Define portable server contracts | `@nestrum/runtime` | Complete |
| [PM1.2 — Node production runtime](phase-02-node-runtime.md) | Implement the first HTTP adapter | `@nestrum/runtime-node` | Complete |
| [PM1.3 — Build](phase-03-build.md) | Produce validated production artifacts | CLI/build pipeline | Complete |
| [PM1.4 — Serve](phase-04-serve.md) | Start a previously built application | production startup | Not Started |
| [PM1.5 — Dev](phase-05-dev.md) | Own regeneration, watching, and restart | development orchestrator | Not Started |
| [PM1.6 — Runtime hardening](phase-06-hardening.md) | Verify health, readiness, shutdown, and integration | runtime lifecycle | Not Started |

Each phase updates its documentation and leaves the repository green. Read [architecture](../../architecture.md), [the post-MVP roadmap](../../post-mvp.md), and the relevant phase record before implementation. The phase records follow the [existing completion requirements](../../phases/README.md#completion-requirements).

## 1. Purpose and goal

Nestrum should become self-serving: users define their application, explicit apps, resources, policies, databases, and admin configuration. They should not manually create or maintain the HTTP bootstrap that loads Hono, InferDI, Better Auth, Prisma, the Svelte admin, or the Nestrum lifecycle.

The target developer experience is:

```json
{
  "scripts": {
    "dev": "nestrum dev",
    "build": "nestrum build",
    "start": "nestrum serve"
  }
}
```

Development uses `pnpm dev`. Production uses `pnpm build` followed by `pnpm start`.

The framework owns the complete path:

```text
Application definition
        ↓
Nestrum CLI
        ↓
Configuration discovery
        ↓
Application bootstrap
        ↓
Prisma / Zod / Resources / Auth
        ↓
InferDI
        ↓
Hono
        ↓
Runtime adapter
        ↓
HTTP server
```

## 2. Command responsibilities

| Command | Responsibilities |
| --- | --- |
| `nestrum dev` | Establish development environment; generate artifacts; watch, regenerate, and restart; provide diagnostics; serve Svelte/Vite development assets |
| `nestrum build` | Load configuration; validate apps, resources, QuerySets/managers, ABAC, auth, and admin; assemble Prisma contracts; generate Prisma artifacts, metadata, and Zod; build server/admin; write a production manifest |
| `nestrum serve` | Load a production build; initialize databases, InferDI, Better Auth, and apps; register Hono routes; serve built admin; complete readiness; start the listener; shut down gracefully |

`dev` owns the development loop. `build` prepares every artifact required by `serve`. `serve` is strictly a production runtime.

## 3. User bootstrap code should disappear

Normal users should not need code such as:

```ts
import { serve } from "@hono/node-server";
import { createApplication } from "@nestrum/hono";

const app = await createApplication(/* application definition */);

serve({
  fetch: app.fetch,
  port: 3000,
});
```

`nestrum dev`, or `nestrum build` followed by `nestrum serve`, should be sufficient. The user's responsibility ends at defining the application.

## 4. Runtime portability

Nestrum remains Node-first and runtime-portable in design. Node serving APIs must remain outside `@nestrum/cli` and core. Introduce a runtime adapter boundary:

```ts
export interface RuntimeAdapter {
  serve(
    application: NestrumApplication,
    options: ServeOptions,
  ): Promise<ServerHandle>;
}
```

This is a proposed contract shape, not an existing exported API. PM1.1 resolved the application type as a Fetch-handler-only `ServableApplication` (see [PM1.1](phase-01-runtime-adapter.md)).

Initial packages are `@nestrum/runtime` and `@nestrum/runtime-node`. Possible future adapters are `@nestrum/runtime-bun`, `@nestrum/runtime-deno`, and `@nestrum/runtime-cloudflare`. Only Node needs official support initially. Prisma and database driver compatibility remain portability constraints.

## 5. Runtime package responsibilities

| Package | Owns |
| --- | --- |
| `@nestrum/runtime` | Runtime-neutral `RuntimeAdapter`, `ServerHandle`, `ServeOptions`, and required lifecycle/health/readiness types; no Node APIs |
| `@nestrum/runtime-node` | Node HTTP listener, Hono Fetch serving, host/port handling, request draining, signal integration, and graceful close |
| `@nestrum/cli` | `dev`, `build`, and `serve` orchestration, configuration discovery, build loading, and adapter selection; no HTTP listener implementation |

The existing Hono layer remains responsible for request routing and request/DI scope ownership. Runtime adapters supply the host boundary.

## 6. Application entry contract

Discover one conventional entry point, `nestrum.config.ts`. The target syntax is illustrative and requires implementation; it does not replace the existing `defineApplication`/`defineCliConfig` APIs today:

```ts
import { defineConfig } from "@nestrum/core";

import { ProjectsApp } from "./src/apps/projects/app";
import { UsersApp } from "./src/apps/users/app";

export default defineConfig({
  databases: {
    default: {
      provider: "postgresql",
    },
    documents: {
      provider: "mongodb",
    },
  },
  auth: {
    database: "default",
  },
  apps: [UsersApp, ProjectsApp],
  server: {
    host: "0.0.0.0",
    port: 3000,
  },
});
```

Database connections still need explicit validated configuration; provider-only examples do not imply credential discovery. Implementation must document connection resolution and compatibility with existing database CLI configuration.

Configuration discovery does not introduce filesystem app discovery. Apps remain explicitly listed in `apps`.

## 7. Server configuration precedence

Resolve each server option in this order:

```text
CLI flag → environment variable → nestrum.config.ts → Nestrum default
```

`nestrum serve --port 8080` overrides `PORT=4000`, which overrides `server: { port: 3000 }`. Initial environment variables are `HOST`, `PORT`, and `NESTRUM_ENV`.

`dev` establishes development and `serve` establishes production. Application code should prefer Nestrum's environment abstraction over direct dependence on `NODE_ENV`. Define defaults, validation, and handling of conflicting `NESTRUM_ENV` values during implementation; an environment override must not turn `serve` into a development process.

## 8. Build output

Introduce the framework-owned `.nestrum/` directory and ensure it is automatically ignored by source control. Its internal layout may evolve; users treat it as an implementation detail.

```text
.nestrum/
├── manifest.json
├── server/
│   └── index.mjs
├── admin/
├── generated/
│   ├── models/
│   └── zod/
└── contracts/
    ├── default/
    └── documents/
```

## 9. Production build pipeline

`nestrum build` performs:

```text
load nestrum.config.ts
        ↓
validate application configuration
        ↓
validate app dependency graph
        ↓
assemble Prisma contracts
        ↓
generate Prisma artifacts
        ↓
compile model metadata
        ↓
generate Zod schemas
        ↓
validate Resources
        ↓
validate QuerySets / managers
        ↓
validate ABAC
        ↓
validate Better Auth configuration
        ↓
validate admin configuration
        ↓
build server
        ↓
build Svelte admin
        ↓
write .nestrum/manifest.json
```

Production startup must not require TypeScript transpilation or schema generation. The build validates framework registrations without implicitly applying migrations. PM1.3 must separate build-time validation from hooks or initialization that require live runtime services.

## 10. Production manifest

The build emits `.nestrum/manifest.json`. It should eventually record:

- Nestrum version and build/manifest version.
- Runtime adapter and entry module.
- Admin assets.
- Database names and application identifiers.
- Contract artifact and generated metadata locations.
- Build timestamp.

`serve` validates compatibility with the installed runtime. PM1.3 defines the initial versioned schema; PM1.4 implements compatibility and required-artifact checks.

## 11. Production startup

`nestrum serve` runs this flow:

```text
read production manifest
        ↓
validate build compatibility
        ↓
load built application
        ↓
initialize configured databases
        ↓
initialize InferDI
        ↓
initialize Better Auth
        ↓
register resources / policies / managers
        ↓
register public Hono routes
        ↓
register admin API
        ↓
mount built Svelte admin
        ↓
run app lifecycle hooks
        ↓
complete readiness
        ↓
start HTTP listener
```

This is the subsystem composition outline. Preserve current lifecycle barriers: resource validation precedes configure hooks; configuration-dependent route/admin registration completes after configure and before ready hooks. Do not move ready ahead of required subsystems.

Production has no watching, HMR, TypeScript transpilation, automatic Prisma/Zod regeneration, development error pages, or implicit database migrations.

## 12. Missing build behavior

`serve` never silently performs a production build. If no build exists, fail clearly:

```text
NestrumError:
No production build found.

Run:
  nestrum build
```

This keeps deployments reproducible and prevents unexpected production work at startup.

## 13. Production startup validation and readiness

Before accepting traffic, validate build compatibility, application/database configuration, Prisma clients, app dependency graph, resources, QuerySets/managers, policies, Better Auth, and admin configuration.

If `ready()` completes successfully, all required Nestrum subsystems have initialized and the server is ready to begin accepting traffic. Bind the listener only after this readiness barrier succeeds. Startup failure must clean up partially initialized infrastructure.

## 14. Graceful shutdown

Handle `SIGINT` and `SIGTERM` with this ordered lifecycle:

```text
receive shutdown signal
        ↓
stop accepting new connections
        ↓
drain active requests
        ↓
run app.shutdown() in reverse dependency order
        ↓
dispose InferDI application/request infrastructure
        ↓
disconnect Prisma databases
        ↓
close runtime
```

Listener gating, draining, and final close must compose with existing Hono request ownership and application cleanup. PM1.2 supplies the draining foundation; PM1.6 specifies and tests timeout/cancellation behavior and repeated signals. Docker, Kubernetes, systemd, cloud runtimes, and process managers rely on this lifecycle.

## 15. Development startup

`nestrum dev` uses the same application definition as production:

```text
load nestrum.config.ts
        ↓
validate application
        ↓
assemble Prisma contracts
        ↓
generate Prisma artifacts
        ↓
compile metadata
        ↓
generate Zod
        ↓
validate Resources
        ↓
start application
        ↓
start development watcher
        ↓
serve admin development assets
```

Development owns regeneration and reload behavior.

## 16. Initial development restart strategy

Use a complete backend restart when application code changes. Sophisticated backend HMR is out of scope initially; correctness and simplicity take priority.

## 17. Development watch categories

| Change | Required behavior |
| --- | --- |
| Application TypeScript: services, policies, resources, QuerySets, `app.ts`, `admin.ts` | Recompile/reload application code, then restart backend |
| `*.prisma` fragments | Reassemble affected database contract, regenerate Prisma artifacts, metadata, and Zod, revalidate resources, then restart backend |
| `nestrum.config.ts` | Complete development restart |
| Custom admin Svelte components | Use Vite/Svelte HMR where practical; pure frontend edits should not require backend restart |

## 18. Development diagnostics

Owning the process enables framework-aware diagnostics. Illustrative success output:

```text
Nestrum 0.2.0

Application
  Apps       4
  Resources  12
  Databases  2

Databases
  default    PostgreSQL
  documents  MongoDB

HTTP
  API        http://localhost:3000/api
  Admin      http://localhost:3000/admin
  OpenAPI    http://localhost:3000/api/openapi.json

Watching for changes...
```

The version/counts are examples. OpenAPI uses the current `/api/openapi.json` route; this initiative does not introduce an alias.

Illustrative framework error:

```text
ResourceError

default.Project references model "Project"
but Project does not exist in the current Prisma contract.

App:
  projects

File:
  src/apps/projects/resource.ts
```

Report app, database/model identity, and source ownership where available, without exposing credentials.

## 19. Database migration behavior

Development must not automatically mutate databases after contract changes. Report the need for explicit migration:

```text
Schema changed.

Database "default" may require migration.

Run:
  nestrum db migrate --database default
```

An opt-in such as `nestrum dev --migrate` may be considered later; it is not required here and must not become the default.

Production never implicitly migrates. Deployment remains `nestrum db migrate` followed by `nestrum serve`. Preserve the existing migration review/confirmation workflow; these command examples do not waive it.

## 20. Admin serving

Production builds Svelte admin assets into `.nestrum/admin/` and serves them at `/admin/*`. The private API remains `/__admin/*`, protected by a Better Auth session, `admin.access` ABAC, and same-origin restrictions.

Development may internally start and proxy a Svelte/Vite development server. Keep the user-facing route at `/admin` where practical and preserve the authentication/origin boundary.

## 21. Health and readiness

Initial endpoints:

| Endpoint | Meaning |
| --- | --- |
| `/__nestrum/health` | Process/runtime is alive; does not necessarily imply database/dependency readiness |
| `/__nestrum/ready` | Bootstrap succeeded, required databases/subsystems initialized, and app ready hooks completed |

Readiness must reflect shutdown and startup failure correctly. Routes should eventually be configurable or disableable. Initial responses expose minimal information.

## 22. Security considerations

`serve` must not expose development diagnostics pages, source maps unless configured, internal inspectors, Vite endpoints, watcher endpoints, or development metadata. Deliberately classify private framework endpoints; health/readiness disclose minimal information. Development convenience must preserve production determinism and admin authentication/authorization.

## 23. Package layout

```text
packages/
├── cli/           → @nestrum/cli (existing; extended by this initiative)
├── runtime/       → @nestrum/runtime (planned)
└── runtime-node/  → @nestrum/runtime-node (planned)
```

Introduce each new package in its implementation phase, not during PM1.0.

## 24. Phase summary

The [phase table](#status-and-navigation) splits the initiative into bounded implementation sessions. Each phase records scope, interfaces, tests, acceptance criteria, validation evidence, limitations, and follow-ups. Larger phases may be split into sessions, each leaving a green repository.

## 25. PM1.0 — Runtime documentation and contract

Create this index and seven phase records under `docs/post-mvp/runtime/`; update `docs/post-mvp.md` and `docs/architecture.md`. Document command responsibilities, portability, production/development behavior, migration rules, package boundaries, and phase scope. No runtime implementation. See [PM1.0](phase-00-runtime-contract.md).

## 26. PM1.1 — Runtime adapter abstraction

Create `@nestrum/runtime` with the minimum portable adapter/lifecycle contracts. Proposed starting shapes include `ServerHandle.close(): Promise<void>` and `ServeOptions` with host/port. Avoid speculative `RuntimeContext`, `RuntimeCapabilities`, or `RuntimeEnvironment` abstractions until needed. Prove the contract with a fake Vitest adapter; exclude Node serving, CLI orchestration, watchers, and build pipeline. See [PM1.1](phase-01-runtime-adapter.md).

## 27. PM1.2 — Node runtime adapter

Create `@nestrum/runtime-node` for Node HTTP serving, Hono Fetch integration, host/port, startup, clean close, and request-draining foundations. Test real HTTP and keep the portable package Node-free. No watcher or production build loading. See [PM1.2](phase-02-node-runtime.md).

## 28. PM1.3 — Build

Implement `nestrum build`, validated server/admin output, Prisma contracts/artifacts, metadata/Zod artifacts as appropriate, and a manifest. Invalid resource/model references and app graphs must fail. Output must be sufficient for production serving. See [PM1.3](phase-03-build.md).

## 29. PM1.4 — Serve

Implement production manifest loading/compatibility, built application startup, databases/auth/routes/admin, and Node adapter serving without user bootstrap. Verify public API, admin UI/API, and Better Auth. Fail clearly for missing builds; load no development tooling. See [PM1.4](phase-04-serve.md).

## 30. PM1.5 — Dev

Implement one-command configuration loading, generation, startup, watching/restart, admin development serving, and framework diagnostics. Watch TypeScript, Prisma fragments, configuration, and admin extensions. See [PM1.5](phase-05-dev.md).

## 31. PM1.6 — Runtime hardening

Test signals, graceful shutdown/draining, health/readiness, startup rollback, missing/stale build handling, and diagnostics. Integrate `build → serve → HTTP request → shutdown` and `dev → edit → restart → changed HTTP response`. Remove manual HTTP bootstrap from the example and mark the initiative complete only when all criteria pass. See [PM1.6](phase-06-hardening.md).

## 32. Final application layout

```text
my-app/
├── src/
│   └── apps/
│       ├── users/
│       └── projects/
├── nestrum.config.ts
├── package.json
└── pnpm-lock.yaml
```

Normal applications require no `server.ts`, `main.ts`, `bootstrap.ts`, or `http.ts`. Deliberate control of bootstrap may become a future advanced escape hatch.

## 33. Recommended package scripts

```json
{
  "scripts": {
    "dev": "nestrum dev",
    "build": "nestrum build",
    "start": "nestrum serve",
    "test": "vitest run",
    "check": "nestrum check"
  }
}
```

`nestrum check` is a potential future command, not a requirement of this initiative or a currently available command. It could validate TypeScript, Svelte, Prisma contracts, resources, ABAC, app dependencies, and admin registrations. Until implemented, applications retain their existing validation scripts.

## 34. Deployment model

```bash
pnpm install --frozen-lockfile
pnpm build
nestrum db migrate
pnpm start
```

The equivalent framework flow is `nestrum build`, explicit `nestrum db migrate`, then `nestrum serve`. Production serving never performs migration automatically.

## 35. Docker-friendly model

The target naturally supports eventual Docker packaging:

```dockerfile
RUN pnpm install --frozen-lockfile
RUN pnpm build

CMD ["pnpm", "start"]
```

The server honors `HOST`, `PORT`, and `SIGTERM` without application-owned bootstrap code.

## 36. Design rules

1. `dev` and `serve` are framework-owned lifecycle commands, not wrappers around user-written servers.
2. `serve` only serves production builds.
3. `dev` may generate and reload.
4. `serve` must not mutate databases automatically.
5. Runtime-specific APIs remain outside core; Node serving remains in `runtime-node`.
6. Application configuration remains explicit; no automatic app discovery.
7. Development convenience must not weaken production determinism.
8. Every runtime phase updates its documentation.

## 37. Definition of done

- [ ] Users define `nestrum.config.ts`.
- [ ] No application-owned HTTP bootstrap is necessary.
- [ ] `nestrum dev` loads and serves the application.
- [ ] Source changes reload automatically in development.
- [ ] Prisma changes trigger framework regeneration.
- [ ] Svelte admin development works under `dev`.
- [ ] `nestrum build` produces a production build.
- [ ] `nestrum serve` serves it without compilers/watchers.
- [ ] Better Auth, public APIs, admin APIs, and Svelte admin work.
- [ ] Graceful shutdown works.
- [ ] Health/readiness work.
- [ ] Database migrations remain explicit.
- [ ] Node serving is isolated behind `@nestrum/runtime-node`.
- [ ] Documentation accurately describes the finished implementation.

## 38. Architectural summary

```text
                  nestrum.config.ts
                         │
                         ↓
                  Nestrum CLI
                 /      |      \
                /       |       \
               ↓        ↓        ↓
             dev      build     serve
              │         │         │
              │         ↓         ↓
              │     .nestrum/   Manifest
              │         │         │
              └─────────┴─────────┘
                        ↓
               Nestrum Application
                        ↓
       ┌────────────────┼────────────────┐
       ↓                ↓                ↓
    Prisma           Better Auth       Admin
       ↓                ↓                ↓
    Resources         Subject          Svelte
       ↓                ↓                ↓
    QuerySets          ABAC          /__admin
       └────────────────┼────────────────┘
                        ↓
                       Hono
                        ↓
                Runtime Adapter
                        ↓
             @nestrum/runtime-node
                        ↓
                    HTTP Server
```

The framework owns how the defined application is developed, built, started, served, and shut down.
