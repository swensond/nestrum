# Nestrum architecture

## Current implementation

Phases 0–4 provide workspace tooling, @nestrum/core application/registry/lifecycle primitives, named database definitions, and @nestrum/prisma fragment assembly with real PostgreSQL/MongoDB contract emission. Phase 4 adds portable immutable metadata compilation and @nestrum/zod runtime schema families. The portable Prisma root entry point holds configuration and metadata; @nestrum/prisma/node handles filesystem/process work. Live clients, resources, QuerySets, authorization, HTTP, authentication, admin, and Nestrum CLI remain unimplemented.

## Principles and dependencies

Nestrum favors Django-like conventions, useful defaults, runtime registration, minimal boilerplate, and explicit escape hatches. Prisma is foundational; the framework does not promise ORM independence. Better Auth is fundamental and not interchangeable. Resources mostly override inferred defaults instead of restating models.

The target stack is Hono, InferDI, Prisma 8, Better Auth, Zod with Nestrum-owned generation, `@hono/zod-openapi`, Svelte 5/SvelteKit, TypeScript 7, pnpm, and Vitest. Svelte checks use `svelte-check-native`. Playwright is reserved for high-level end-to-end validation. Node is the initial runtime; avoid unnecessary Node dependencies in portable core code. Bun, Deno, and Cloudflare are future work where Prisma and drivers permit.

Package scope is `@nestrum/*`: `core`, `prisma`, `zod`, `hono`, `auth`, `admin`, `admin-svelte`, `cli`, and `testing`. Core, prisma, and zod exist today. Zod consumes Prisma metadata; Prisma depends on core; core does not import prisma. Applications eventually live under `apps/example` and `apps/admin-dev`; container infrastructure is introduced when needed.

## Applications and lifecycle

Apps are explicitly registered using `defineApp()` and `defineApplication()`. Each app owns Prisma fragments, resources, policies, QuerySets, services, admin registration, and `configure()`, `ready()`, and `shutdown()` hooks. Typical layout is `src/apps/projects/{prisma,resources,policies,querysets,services}`, plus `admin.ts` and `app.ts`.

Phase 1 implements defineApp(definition), AppRegistry, and Application. Phase 2 extends defineApplication to require { apps, databases } with an own default database. Database configuration validates before the app graph; both validate before hooks. App definitions and dependency arrays are copied/frozen. AppRegistry has(name), get(name), and all() expose lookup and a frozen startup-order list; unknown lookup throws a coded error.

Duplicate names, missing dependencies, and cycles fail. App names are nonempty with no leading/trailing whitespace. Ordering uses depth-first traversal in registration order, following each app's declared dependency order. Shared/repeated dependencies execute once. Independent apps retain registration order; dependencies can move ahead of earlier registered dependents. Cycle errors report the cycle path.

Awaiting application.start() runs all configure hooks in topological order, then all ready hooks in that order. Hooks receive a frozen { application, apps, databases } context and may return void or a Promise. Awaiting application.shutdown() runs shutdown hooks in reverse topological order. Calls after completed startup/shutdown are idempotent. Overlapping lifecycle operations are rejected, and stopped/failed instances cannot restart.

Startup failure attempts reverse cleanup for every app whose configure phase was entered, including the failing app. Ready failure cleans up every configured app. Cleanup continues after hook failures. Hook errors retain app/hook identity and original cause; multiple errors are preserved in AggregateError causes. Every eligible shutdown hook is attempted at most once. See [the lifecycle decision](decisions/0002-application-lifecycle.md) and [Phase 1](phases/phase-01-application.md).

The final bootstrap target, beyond the currently implemented database registration and app hooks, is:

1. Load configuration and resolve databases.
2. Validate the app graph and topologically order apps.
3. Collect fragments, assemble and validate per-database Prisma contracts.
4. Compile metadata and generate Zod schemas.
5. Register and validate resources, then managers and policies.
6. Configure InferDI and invoke app `configure()` hooks.
7. Register Better Auth, public routes, admin API, and Svelte admin.
8. Invoke app `ready()` hooks, then accept traffic.

Shutdown stops accepting traffic, runs reverse app shutdown, disposes InferDI, and disconnects databases. The lifecycle is implemented incrementally and hardened in Phase 15.

## Databases and contracts

Every application defines a `default` database. Named Prisma-backed databases are first-class from Phase 2. Model identity is `<database>.<model>`, such as `default.Project` or `documents.Article`. Resources default to `default` and may explicitly select another database.

Phase 2 implements DatabaseRegistry in core and prismaDatabase({ provider, connection }) in @nestrum/prisma. Recognized providers are postgresql and mongodb, matching the MVP integration targets. The factory and registry validate definitions; each registered value is a frozen copy with kind: 'prisma'. Connections are opaque nonempty strings without surrounding whitespace; URL semantics and actual reachability belong to later provider/runtime integration. Error messages do not echo connection values.

DatabaseRegistry accepts named objects or low-level named entry arrays, rejects duplicates in entry arrays, requires an own default entry, and exposes get(name = 'default'), has(name), and names(). Missing/invalid configuration fails during application construction, before lifecycle hooks. JavaScript object literals cannot preserve already overwritten duplicate keys. Same connection settings under different names are allowed; cross-database relation/transaction emulation is still excluded.

Database and model names use ASCII identifier segments: a letter or underscore followed by letters, digits, or underscores. Names are case-sensitive and are not normalized. modelIdentity(model, database = 'default') produces an unambiguous identity and validates both segments; it does not check registration or model existence. Model existence is validated in Phase 5. See [the database boundary decision](decisions/0003-database-registration-boundary.md).

Apps declare prisma: { databaseName: [fileOrDirectoryPaths] }. Core snapshots/freezes contribution maps and path arrays. @nestrum/prisma/node resolves paths against an explicit rootDir, traverses installed apps in dependency order, and discovers regular .prisma files recursively in sorted filename order. Missing/empty/invalid inputs, unregistered target databases, and duplicate physical files within one database fail with source ownership. Explicit symlink paths are rejected; symlinks encountered in directories are skipped. Apps without contributions are skipped, and files can be reused under distinct database identities.

assemblePrismaContracts(application, { rootDir }) returns frozen per-database source snapshots without semantic parsing. generatePrismaContracts(application, { rootDir, outputDir }) additionally stages sources and invokes Prisma contract emit. Duplicate or conflicting definitions and unresolved relations fail through native diagnostics, with original app/path provenance appended. Definition conflicts are validated at generation, not at the filesystem collection stage.

Public Prisma CLI/PostgreSQL/MongoDB facade dependencies are pinned to 8.0.0-rc.13. The installed native source loader lacks the glob behavior described by newer docs, so fragments are combined into one generated contract.prisma per database. App-owned fragments remain separate. Each input is included behind the generated // use prisma-8 header; copied fragments and provenance are retained. SQL relations across fragments work within a database; cross-database relations are not emulated.

Emission is offline and omits connection settings from generated configs. It produces contract.json and contract.d.ts under a fresh run directory, without overwriting prior artifacts. The config/source paths are tied to the installed packages and should be regenerated if moved. Application.start() does not automatically emit: call generation before startup until the full pipeline is integrated in later phases. Framework-owned apps, including future auth, use the same contribution metadata.

The original frozen MVP PSL example uses @updatedAt and legacy cuid() syntax that the pinned native emitter rejects. Phase 4 supports it through explicit authoring: { default: 'prisma7' }, using the official PostgreSQL adapter with a contributed datasource block. It maps cuid() to cuid2 and DateTime to Temporal.PlainDateTime. Native mode stays default and does not rewrite fragments. Native Mongo fixtures use ObjectId. See [ADR 0004](decisions/0004-prisma-contract-assembly.md).

Cross-database relations are not emulated. Transactions are single-database only. Distributed transactions are out of scope; future consistency may use events, outbox, or sagas.

## Metadata, schemas, and resources

The metadata compiler emits model database, name, canonical identity, and field metadata. Supported initial scalar shapes include strings, numbers, bigint, booleans, dates/datetimes, enums, optional/nullable values, and provider-supported arrays. Relations remain in metadata without granting unrestricted nested API schemas.

Nestrum owns generation of `Model`, `Create`, `Update`, `Read`, `Where`, and `OrderBy` Zod schema families. `Select`, `Include`, `Cursor`, and `Aggregate` are deferred. Resources compose generated defaults, for example `schemas.create(schema) { return schema.extend(...); }`. Replacement is a possible advanced escape hatch, not the normal path.

Phase 4 exposes compileModelMetadata({ database, provider, contract }) in @nestrum/prisma and generateModelSchemas(metadata, options?) in @nestrum/zod. Metadata is deeply frozen and sorted, with canonical identities, provider namespaces, scalar codecs, null/optional/list flags, primary keys, create/update default flags, enum values, and separate relations. Physical SQL mappings determine defaults and keys; native Mongo names (including _id) are preserved. Namespace collisions fail. Unsupported codecs fail explicitly.

Families expose strict model/create/update/read/orderBy object schemas, recursive where validation, metadata, and stable schema labels. Runtime families are keyed by canonical identity; named TypeScript source generation is deferred. Create omits nullable/optional/defaulted fields; Read keeps SQL nullable fields required and allows absent optional Mongo fields. Update accepts empty partial records and excludes primary keys. Defaulted timestamps remain overridable at this baseline. Relations do not enter validation shapes.

Codec representations remain distinct: Date, bigint, ISO strings, and Temporal types are validated without coercion. Temporal uses the runtime global or an explicit implementation supplied to generation; framework code does not install a polyfill. JSON transport is later API work. Where supplies a limited scalar/list/logical vocabulary; execution and provider restrictions await QuerySets. See [Phase 4](phases/phase-04-zod-generation.md) and [ADR 0005](decisions/0005-metadata-and-runtime-schemas.md).

`defineResource({ model: 'Project' })` resolves to `default.Project`. Missing models fail at bootstrap and at build time where feasible. Public API exposure defaults to disabled; explicit operation flags enable list, retrieve, create, update, and delete. `api: false` is a normal admin-only resource.

## QuerySets and managers

Immutable, chainable, strongly typed Prisma-backed QuerySets are the primary access layer. Filtering, Django-style ordering (including `'-createdAt'`), and limits compose without evaluation. Evaluation includes `all`, `first`, `get`, `exists`, `count`, `create`, `update`, and `delete`.

Every resource has an irreplaceable `objects` manager. Named managers such as `active` or `archived` are first-class and remain chainable. `objects.raw()` explicitly returns the Prisma delegate and leaves automatic Nestrum ABAC scoping and manager behavior. Documentation must make that escape hatch explicit when it is implemented.

## Authorization

ABAC evaluates subject, action, resource, and environment. Default deny applies to missing policies and actions. Arbitrary actions (including archive, publish, approve, and transfer) work from the start. Resource denial always wins.

Policies support collection query scopes and object authorization. Provider-neutral filters include `eq`, `neq`, `in`, `notIn`, `isNull`, `and`, `or`, and `not`, compiled to Prisma. `.authorizedFor(subject, action)` applies scopes in the database query rather than post-fetch filtering. Field-level ABAC is excluded to preserve stable response schemas and simple admin behavior.

## HTTP and public API

Hono owns HTTP; InferDI supplies isolated request scopes and cleanup. Scopes may expose application, databases, authorization, subject, and environment. Consistent error mapping and anonymous subjects precede authentication integration.

Opt-in public CRUD routes live under `/api/*`: GET collection, GET `/:id`, POST collection, PATCH `/:id`, and DELETE `/:id`. The pipeline is generated Zod validation → QuerySet and ABAC → Prisma → generated Read validation → response. OpenAPI is generated from the same enabled operations through `@hono/zod-openapi`. Arbitrary Prisma `select/include`, nested writes, and unrestricted relationship expansion are excluded.

## Authentication

`@nestrum/auth` owns the Better Auth Prisma 8 adapter and protected `User`, `Session`, `Account`, and `Verification` contracts. Apps select an auth database using `auth.database` and extend sanctioned fields through `auth.extend`, for example an optional user timezone. The core user stays minimal and authentication-oriented; domain data normally belongs in a separate one-to-one profile.

Register, login, logout, and session retrieval are MVP features. A SubjectFactory maps Better Auth sessions into ABAC subjects.

## Admin and extensions

`/admin/*` serves the prebuilt Svelte UI; `/__admin/*` is its private API; `/api/*` remains the opt-in public boundary. Admin requires a Better Auth session, default-deny `admin.access`, and same-origin requests by default. Cross-origin access requires explicit `admin.allowedOrigins`.

Admin registration is separate from resources: `admin.register(Resource, { listDisplay, fields, actions })`. The API provides resource/field metadata, list configuration, generic CRUD, known custom actions, and authorization-aware access using the same QuerySet/ABAC stack.

Svelte routes are generic: `/admin`, `/admin/[resource]`, `/admin/[resource]/new`, and `/admin/[resource]/[id]`. Navigation comes from metadata; ordinary resources never need a dedicated Svelte page. Generic components cover list/table/form/create/edit/delete and field rendering. Initial widgets are string, textarea, number, boolean, enum/select, date, datetime, and readonly. Server validation remains authoritative.

Custom actions use ordinary ABAC action names before their handler. A component plugin/slot registry permits custom widgets without editing admin internals. The general plugin design leaves contribution seams for apps, resources, DI providers, admin components, CLI commands, and database extensions. A full plugin ecosystem is deferred.

## CLI and provider seams

The public command is `nestrum`. MVP database commands are `nestrum db generate`, `nestrum db migrate`, and `nestrum db status`, with future/phase-designed named targeting such as `--database documents`. Internal Prisma delegation is allowed; direct Prisma commands are not the public workflow. `nestrum new` and `nestrum dev` are naming examples, not additional MVP commands.

Provider extension seams preserve future Mongo collection compression, indexes, extensions, partitioning, and physical options; implementations of advanced storage features remain deferred.

## Tooling decisions

The root compiler is pinned TypeScript 7.0.2, using `tsc`. Packages compile under strict NodeNext resolution to ES2022 ESM and declarations. Core compilation starts without ambient Node types; test/config checking has explicit Node types. Vitest 5 uses `test.projects`; `vitest.workspace.ts` is an explicitly imported list, not deprecated workspace discovery. See [the tooling decision](decisions/0001-workspace-tooling.md).

With three packages, root no-emit checking and Vitest SSR resolution use the nestrum-source export condition for current workspace sources. Package builds retain ordinary declaration/dist resolution and execute in dependency order (core before prisma before zod). Ordinary Node imports resolve compiled JavaScript. The Phase 2 factory remains configuration-only; Phase 3 adds real Prisma dependencies for offline emission.

Cross-feature core imports use the #core/* package import alias. Core compilation selects source through nestrum-source; normal runtime/type consumers resolve emitted JavaScript/declarations. Relative imports remain within feature modules.

Prisma CLI requires Node >=22.18.0, so the root engine range is ^22.18.0 || ^24.0.0 || >=26.0.0. pnpm allows the pinned esbuild build script; unused optional msgpackr-extract/workerd scripts are explicitly disabled. Prisma package Node types support its separate Node entry point; core has no Node imports.
