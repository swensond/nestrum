# Database workflow and lifecycle

The public database command is `nestrum` from `@nestrum/cli`. In this workspace, run `pnpm build` first, then `pnpm exec nestrum`. Applications install the CLI package alongside their framework packages. Node 22.18+, 24, or 26+ can load the default `nestrum.config.ts`; configuration must use erasable TypeScript or compiled ESM, because Node's native TypeScript loader does not transform arbitrary syntax or resolve TypeScript path aliases.

## Configuration

```ts
import { defineApplication } from '@nestrum/core';
import { defineCliConfig } from '@nestrum/cli';
import { projects } from './src/apps/projects/app.js';

export default defineCliConfig({
    application: defineApplication({
        apps: [projects],
        database: { kind: 'prisma', provider: 'postgresql', connection: process.env.DATABASE_URL! }
    }),
    outputDir: '.nestrum/contracts',
    migrationsDir: 'prisma/migrations',
    timeoutMs: 30000
});
```

Configuration exports an unstarted application. Importing config can execute application code, so configuration should define dependencies without opening listeners or connections at module scope. The CLI never invokes app startup, configure/ready hooks, or managed database callbacks. `rootDir` defaults to the config module's directory; a relative override resolves from that directory. Fragment, output, migration, and provider module paths resolve from rootDir. `--config` resolves from the command's working directory.

## Commands

```bash
pnpm exec nestrum db generate
pnpm exec nestrum db generate --json
pnpm exec nestrum db migrate --plan --name initial
# Review and commit prisma/migrations before applying.
pnpm exec nestrum db migrate
pnpm exec nestrum db status
```

All commands act on the application's one database and emit its assembled contract into a fresh output run directory (`contractDir`, `outputDir`, or `.nestrum/contracts`). Native provider validation remains authoritative; `authoring: 'prisma7'` retains the explicit PostgreSQL compatibility mode.

`generate` emits contract.json and contract.d.ts offline. `migrate --plan` delegates offline `migration plan`, producing durable migrations under `prisma/migrations` even though contracts use fresh run directories. `migrate` delegates `db migrate` to apply existing reviewed migrations; it does not invent a migration while applying. If Prisma requests consent, repeat `--confirm <token>` using the exact requested token. It is valid only when applying migrations. `status` delegates `migration status`, querying the live database marker and reporting pending paths. Neither apply nor status automatically plans migrations. `--json` forwards machine-readable output; no command silently accepts consent defaults.

Nestrum supplies the provider config and selected connection internally. Credentials travel through the child process environment, never command arguments or generated config files. Exact connection URLs are redacted from delegated output/errors. Commands use argument arrays rather than a shell, enforce a configurable timeout, and preserve native nonzero exit codes. Missing/unreachable databases and drift produce failure exits. Initial signing, permissions, migration operations, and provider limitations remain Prisma's responsibility; live PostgreSQL application/status proof passes in [Phase 16](phases/phase-16-integration.md).

## Provider extensions

`GeneratePrismaOptions.extensions` and CLI `extensions` accept explicit `PrismaProviderExtension` descriptors from `@nestrum/prisma/node`:

```ts
const searchExtension = {
    owner: 'search',
    name: 'search-contract',
    provider: 'postgresql',
    contribute: () => validatedSearchPrismaSource(),
    controlModule: 'src/database/search-control.mjs'
} as const;
```

At least one of contribute/controlModule is required. Contributors validate their options and return nonempty native Prisma source; thrown failures stop assembly. Source carries owner/name provenance and participates in ordinary duplicate-model/provider validation. `controlModule` names a file whose default export is a provider-compatible Prisma control extension descriptor; it is imported into generated config and inherited by planning/apply/status config. Native provider validation rejects unsupported control descriptors. Modules may execute trusted code and must work in offline emission as well as online commands.

Provider mismatches, unsafe names, and duplicate extension names fail before contributor invocation. Contributions retain explicit input order after app fragments. This seam permits future compression, index, extension, partitioning, and physical-option adapters without adding these advanced implementations now. There is no extension discovery or cross-provider emulation.

## Lifecycle ownership

Application configuration supports `prepare(application)` for awaited offline contract/metadata preparation and `databaseLifecycle` for the explicitly owned connection:

```ts
const application = defineApplication({
    apps,
    database,
    prepare: async () => { await prepareContractsAndSchemas(); },
    databaseLifecycle: { connect: () => connection.connect(), disconnect: () => connection.dispose() },
    resourceModels: () => preparedResourceModels
});
```

The application validates registries before startup, awaits prepare, connects the managed database, then loads/validates resources and initializes authentication before app configure hooks. Configure runs in dependency order; admin initialization and the runtime's route/OpenAPI registration barrier run before any ready hook. Ready hooks finish before HTTP traffic is accepted. Runtime startup requires an unstarted application; call runtime.start rather than starting its application separately.

Shutdown gates Fetch immediately, calls optional runtime `stopTraffic()` to stop the host listener, drains bounded request pipelines and their scope disposal, shuts apps down in reverse dependency order, disposes DI, and disconnects the managed database. Supplied DI roots remain caller-owned unless `di.dispose` explicitly transfers cleanup to this pipeline. `stopTraffic` should stop accepting connections promptly; it owns any host-specific cancellation/drain behavior. App/resource loader failure, route registration failure, and partially failed connect all roll back: entered apps clean up, DI disposes, then a database whose connect was entered receives one disconnect attempt. Cleanup continues and aggregates errors; hooks/disconnects are not retried.

Direct Application.start can receive `beforeReady` and `afterApps` integration callbacks. The runtime uses those callbacks for route registration and container disposal, including startup rollback. `prepare` owns offline generation/metadata work; Nestrum does not infer application client factories or automatically bind provider collections. Application-created clients without databaseLifecycle remain application-owned.

For Node hosts, `installShutdownSignals(runtime)` from `@nestrum/cli` installs SIGINT/SIGTERM handlers and returns a removal function. Repeated signals do not overlap shutdown. Failures go to optional onError; the default sets a failing process exit code. Listener setup remains host-owned; supply stopTraffic when creating the runtime and remove handlers when replacing that host.

Optional `drainTimeoutMs` bounds request draining after stopTraffic returns. A timeout keeps traffic gated, leaves app/DI/database resources open, and returns HTTP_RUNTIME_DRAIN_TIMEOUT. Finish or cancel requests through their host-owned abort controllers, then retry runtime.shutdown to complete safe cleanup. The default awaits all bounded requests without a timer. Streaming response consumption, detached work, force-killing handlers, and universal socket cancellation are not covered by request-scope ownership.

## Docker integration example

Run `pnpm test:integration` with Docker running. The [example](../apps/example/README.md) deploys an isolated PostgreSQL service (or uses `INTEGRATION_POSTGRES_URL`), resolves ephemeral loopback ports, generates/plans/applies/status-checks the database through these commands, and verifies live resources/auth/admin and shutdown before removing its own services/artifacts. The provider facade package keeps generated type and migration imports public under Prisma 8 rc.13.
