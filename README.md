# Nestrum

A Django-like TypeScript framework with strong conventions and runtime registration. **Phases 0–15 are implemented:** workspace tooling, explicit apps, lifecycle, a single PostgreSQL database, Prisma fragment assembly/emission, metadata, generated Zod families, resource registration/composition, QuerySets/managers, default-deny ABAC, a Hono/InferDI runtime, opt-in public CRUD with OpenAPI, framework-owned Better Auth, a private session/ABAC-protected admin backend, and a prebuilt metadata-driven admin shell with generic CRUD, custom widgets, and authorized per-record actions.

The [Docker-backed integration example](apps/example/README.md) proves PostgreSQL resources, auth in the same database, generated public/admin CRUD, generic Svelte forms/browser flows, CLI migrations, and shutdown. MVP completion remains gated on the documented atomic object-policy mutation follow-up.

## Development

Use Node.js 22.18+, 24, or 26+ within the ranges in package.json, and pnpm 12.6.0. TypeScript 7.0.2, Vitest 5.0.2, and Prisma CLI/provider facades 8.0.0-rc.13 are pinned in the workspace.

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm check
pnpm test:integration # requires Docker
```

`pnpm test:watch` starts interactive watch mode. `pnpm check` runs tests, type checking (including native Svelte checks), builds, and compiled admin shell integration. Core, Prisma, Zod, Hono, Auth, Admin, and Admin UI packages emit ESM JavaScript and declarations to their dist directories. Workspace tests/type checking resolve source through the nestrum-source condition; ordinary Node imports use compiled output.

Start with [the documentation index](docs/README.md), [architecture](docs/architecture.md), and [MVP scope](docs/mvp.md). Implement one bounded phase at a time; documentation and validation are part of completion.

## Applications

```ts
import { defineApp, defineApplication } from '@nestrum/core';
import { prismaDatabase } from '@nestrum/prisma';

const users = defineApp({ name: 'users' });
const projects = defineApp({
    name: 'projects',
    dependsOn: ['users'],
    configure({ apps }) {
        apps.get('users');
    },
    async ready() {},
    async shutdown() {}
});

const application = defineApplication({
    apps: [projects, users],
    database: prismaDatabase({ provider: 'postgresql', connection: 'postgresql://localhost/nestrum' })
});
await application.start();
await application.shutdown();
```

The database configuration and app graph validate when the application is defined. All apps configure in dependency order before any ready hook runs; shutdown reverses that order. See [Phase 1](docs/phases/phase-01-application.md) for lifecycle states and failure behavior.

Every application has exactly one PostgreSQL database ([decision 0018](docs/decisions/0018-postgresql-single-database.md)): read it from application.database, and hooks receive the same definition. A model's identity is its name: modelIdentity('Project') returns 'Project'.

Phase 2 registers immutable settings without creating Prisma clients or connecting to the database. See [Phase 2](docs/phases/phase-02-databases.md) for configuration rules.

## Prisma contracts

Apps explicitly contribute files or recursively discovered directories to the database:

```ts
const projects = defineApp({
    name: 'projects',
    prisma: { default: ['src/apps/projects/prisma'] }
});
```

For an application containing these apps, generate before starting it:

```ts
import { generatePrismaContracts } from '@nestrum/prisma/node';

const generated = await generatePrismaContracts(application, {
    rootDir: process.cwd(),
    outputDir: '.nestrum/contracts'
});
await application.start();
```

This offline step emits contract.json and contract.d.ts in a fresh run directory. It does not connect or migrate. Native Prisma 8 authoring is the default. PostgreSQL can opt into authoring: 'prisma7' for legacy syntax through the official adapter. See [Phase 3](docs/phases/phase-03-prisma-contracts.md) for artifacts and [Phase 4](docs/phases/phase-04-zod-generation.md) for metadata, schema generation, and compatibility details.

## Metadata and Zod

compileModelMetadata({ database, provider, contract }) from @nestrum/prisma compiles emitted contract JSON. generateModelSchemas(metadata) from @nestrum/zod returns model/create/update/read/where/orderBy schemas and stable names. Object schemas support Zod .extend() composition. Runtime values follow Prisma codecs, including bigint, Date, and Temporal. Public APIs encode native values as JSON strings; see [Phase 9](docs/phases/phase-09-public-api.md) for transport and Temporal adapters, and [Phase 4](docs/phases/phase-04-zod-generation.md) for runtime shapes.

## Resources

```ts
import { defineResource } from '@nestrum/core';
import { z } from 'zod';

const ProjectResource = defineResource({
    model: 'Project',
    api: { list: true },
    schemas: {
        create: (schema) => schema.extend({ name: z.string().min(3) })
    }
});
```

Register definitions through app.resources or application.resources and supply generated families through application resourceModels (an array or loader). Startup validates every model and composes schemas before app hooks. Lookup uses application.resources.get('default.Project'). Public flags default to false; the Hono runtime generates only enabled operations at startup. See [Phase 5](docs/phases/phase-05-resources.md) for resource bootstrap and [Phase 9](docs/phases/phase-09-public-api.md) for HTTP behavior.

## QuerySets

Every registered resource exposes objects. Bind a Prisma 8 collection through ResourceModel.queryBackend using createPrismaQueryBackend from @nestrum/prisma/querysets. Queries use authorizedFor(subject, 'read').filter(...).orderBy('-createdAt').limit(20) before all()/first()/get()/exists()/count(); writes use create/update/delete. Named managers compose the same immutable QuerySets. bindResourceQuerySets provides typed access such as Project.active when using a typed Prisma collection.

raw() returns the original Prisma collection and bypasses Nestrum validation, manager filters, and automatic ABAC. Applications currently own clients and bindings. See [Phase 6](docs/phases/phase-06-querysets.md) for usage, semantics, and provider limitations.

## Authorization

Register policies through application policies or app policies. Missing policies, actions, and QuerySet authorization contexts deny. Policies are copied/frozen before app hooks; hooks expose authorization.

```ts
import { allow, definePolicy, deny, eq } from '@nestrum/core';

const ProjectPolicy = definePolicy({
    resource: 'Project',
    authorize: ({ subject }) => typeof subject.id === 'string' ? allow() : deny('ANONYMOUS'),
    actions: {
        read: { scope: ({ subject }) => eq('ownerId', subject.id as string) },
        update: { scope: ({ subject }) => eq('ownerId', subject.id as string) },
        archive: {
            operations: ['update'],
            scope: ({ subject }) => eq('ownerId', subject.id as string)
        }
    }
});
// Include ProjectPolicy in the application's or owning app's policies array.
await Project.objects.authorizedFor(subject, 'read').filter({ status: 'active' }).all();
await Project.objects.authorizedFor(subject, 'archive').filter({ id: projectId }).update({ status: 'archived' });
```

Scopes constrain database reads/counts/writes. Object callbacks reject an entire read result on denial; they never silently filter records after fetching. Create checks validated input before inserting. Count and bulk writes reject per-object policies; custom actions must declare their allowed query operations. See [Phase 7](docs/phases/phase-07-abac.md) for the complete boundary and examples.

## Authentication

```ts
import { defineAuth, field } from '@nestrum/auth';

const auth = defineAuth({
    baseURL: 'https://app.example.com',
    secret: process.env.BETTER_AUTH_SECRET!,
    prisma: () => configuredPrismaAuthCollections()
});
```

Nestrum contributes prebaked, protected User, Session, Account, Verification, TwoFactor, and ApiKey contracts (Better Auth's `twoFactor`, `admin`, and `apiKey` plugins are enabled; `SsoProvider` is added for enterprise SSO) and owns the Better Auth Prisma 8 adapter. The User model is not extensible. Users have a role (`user`, `staff`, `admin`); create the first administrator with `nestrum auth create-admin --email you@example.com` (password from `NESTRUM_ADMIN_PASSWORD` or a prompt, run against a previous `nestrum build`), then manage staff in the admin interface at `/admin/access`. `roleBasedAdminPolicies()` from `@nestrum/admin` provides the standard admin policies. Email/password, session, logout, and session retrieval are available under `/api/auth`. Valid sessions become ABAC subjects; absent, expired, or invalid sessions are anonymous. Domain profile data remains separate from the core auth user. See [Phase 10](docs/phases/phase-10-auth.md).

## API keys

Resources opt in to machine authentication with `api.auth`; Better Auth's API-key plugin does the hashing, expiry, revocation, and rate limiting.

```ts
const Project = defineResource({
    model: 'Project',
    api: { auth: ['session', 'api-key'], list: true, retrieve: true, create: true },
});
```

Administrators create keys at `/admin/api-keys` (owner user, scopes such as `projects:read`, expiry, optional rate limit); the full key is shown once. Clients send `X-API-Key: nes_live_…`. A key is its own ABAC subject (`subject.type === 'api-key'`, `subject.owner`, `subject.scopes`) and needs the resource's scope (`projects:read` for list/retrieve, `projects:write` for mutations, or `api.scopes`) **and** an allowing policy. Tune `defineAuth({ apiKeys: { prefix, defaultTtlDays, maxTtlDays, rateLimit } })`. See [decision 0015](docs/decisions/0015-api-keys.md).

## Feature flags

Flags answer "is this capability switched on?"; ABAC still answers "may this subject use it?". Declare boolean flags in source and register them with `defineFeatures`:

```ts
import { defineFeatureFlags } from '@nestrum/core';
import { defineFeatures } from '@nestrum/features';

export const features = defineFeatureFlags({
    newDashboard: { default: false, exposeToClient: true },
    experimentalSearch: { default: false },
});

defineApplication({
    features: defineFeatures({
        flags: features,
        environment: 'production',
        prisma: () => ({ collection: client.orm.public.FeatureOverride }),
    }),
    // ...
});

await features.newDashboard.enabled({ subject, organizationId });
```

Overrides persist in Nestrum's `FeatureOverride` model (migrate it like any contract) and resolve in this order: subject, organization, percentage rollout, environment, global, source default. Rollouts hash flag + stable subject key, so they are deterministic; anonymous actors roll out only through an application-provided `environment.featureKey`. Request scopes inject a `features` service bound to the trusted subject and environment (`scope.get('features')`, `context.var.nestrum.features`). Administrators manage overrides at `/admin/features` (admin 2FA plus the `features` ABAC actions `read` and `manage`) and can explain any decision. Flags marked `exposeToClient: true` are evaluated on the server and served as booleans at `/__nestrum/features`; the consumer UI reads them with `createFeatureClient()` from `@nestrum/web/client`. Tests use `withFeatureFlags(features, { newDashboard: true }, callback)`; `nestrum dev --feature newDashboard=true` overrides a flag for that process only. See [decision 0016](docs/decisions/0016-feature-flags.md).

## Enterprise SSO

OpenID Connect and SAML 2.0 sign-in run on Better Auth's official SSO plugin; Nestrum adds the provider registry, encrypted secrets, enable/disable, domain verification and a prebuilt admin. Applications write no protocol handlers or management pages.

```ts
defineAuth({
    // ...
    sso: { enabled: true }, // trustedIdpOrigins, domainVerification, provisioning, saml.allowIdpInitiated, onAudit
});
```

Administrators manage providers at `/admin/auth/sso` (admin 2FA plus the `sso` ABAC actions `read`, `create`, `update`, `delete`, `enable`, `disable` and `test`). OIDC needs an issuer, client ID and secret; SAML takes IdP metadata XML and shows the ACS URL and entity ID to enter at the IdP. Client secrets and private keys are sealed at rest and never shown again; identity-provider URLs must be public HTTPS unless listed in `trustedIdpOrigins`. Users sign in with `POST /api/auth/sign-in/sso` (by `email`, `domain`, `providerId` or `organizationSlug`; several matches return `409` with a choice list). An SSO session is tagged `authMethod: 'sso'`, its ABAC subject carries `authMethod` and `ssoProviderId`, and it never satisfies admin 2FA; identity-provider claims are never roles. Existing applications migrate the `SsoProvider` table and two `Session` columns. See [decision 0017](docs/decisions/0017-enterprise-sso.md).

## Private admin API

```ts
import { defineAdmin } from '@nestrum/admin';
import { defineResource } from '@nestrum/core';

const Project = defineResource({ model: 'Project', api: false });
const admin = defineAdmin();
admin.register(Project, { listDisplay: ['id', 'name'] });
// Include admin, auth, Project, its compiled model/backend, and policies in defineApplication().
```

The Hono runtime serves `/__admin/*` with a live Better Auth session and a default-deny policy for `admin.access` with action `access`. Resource metadata and CRUD use resource policies independently of public exposure. `GET /__admin/resources` discovers authorized resources; `/__admin/projects` and `/__admin/projects/:id` provide generic CRUD. Lists return `{ rows }` with a default limit of 20 and maximum of 100. Named database slugs use `documents--articles`.

Same-origin access is enforced by default. `defineAdmin({ allowedOrigins: [...] })` enables explicit credentialed cross-origin access. Configured fields support labels, hidden presentation metadata, readonly input restrictions, and widget overrides; composed schemas remain authoritative. Custom action handlers run only after ordinary resource ABAC and scoped read/object checks. See [Phase 11](docs/phases/phase-11-admin-backend.md) for the private boundary and [admin extensions](docs/admin-extensions.md) for action and custom widget registration.

## Admin UI

```ts
import { createAdminShell } from '@nestrum/admin-ui/node';
import { createHonoRuntime } from '@nestrum/hono';

const runtime = createHonoRuntime({ application, adminUi: await createAdminShell() });
await runtime.start();
```

Build before loading the Node entry point. The prebuilt SvelteKit shell serves `/admin` and generic resource/new/detail routes, with navigation from authorized metadata. Email/password login, logout, loading, and safe error boundaries use the existing private backend. Generic lists, create/edit forms, confirmed deletion, and retained validation feedback all use the private API and authoritative server authorization/validation. See [Phase 12](docs/phases/phase-12-admin-shell.md) for hosting and [Phase 13](docs/phases/phase-13-admin-crud.md) for widgets, form behavior, and limitations.

## HTTP runtime

```ts
import { createHonoRuntime } from '@nestrum/hono';

const runtime = createHonoRuntime({ application });
runtime.hono.get('/health', (context) => context.json({ status: context.var.nestrum.application.state }));
await runtime.start();
const response = await runtime.fetch(new Request('http://localhost/health'));
// Pass runtime.fetch to your Fetch-compatible HTTP host.
// Stop the host listener when shutting down, then:
await runtime.shutdown();
```

Requests are gated until startup completes. Each request has an InferDI scope on context.var.di and a frozen framework context on context.var.nestrum. Auth sessions become subjects when configured; otherwise subjects are anonymous, and headers do not authenticate requests. Scopes dispose after the awaited route pipeline, including error paths. Shutdown rejects new requests and drains active pipelines before app shutdown and disposal of the owned root.

Use createRuntimeContainer(application) to register typed services and provide a di.container/createScope pair; a supplied root remains application-owned unless di.dispose opts into lifecycle cleanup. The runtime exposes a Fetch handler; the application owns its TCP listener and can provide stopTraffic to close it before draining. Managed databaseLifecycle callbacks disconnect after app/DI cleanup. See [database workflow](docs/database-workflow.md) for preparation, shutdown, signal, and timeout ownership.

## Database CLI

Export defineCliConfig({ application }) from nestrum.config.ts, then build and use the workspace executable:

```bash
pnpm exec nestrum db generate
pnpm exec nestrum db migrate --plan --name initial
pnpm exec nestrum db migrate
pnpm exec nestrum db status
```

Generation and migration planning are offline; migration application/status use the database connection. Review and commit prisma/migrations before applying. Config loading, native Prisma delegation, provider extensions, and ownership are documented in [database workflow](docs/database-workflow.md).

## Public API

The example Project resource above exposes GET /api/projects. Enable retrieve/create/update/delete individually to add GET /api/projects/:id, POST /api/projects, PATCH /api/projects/:id, and DELETE /api/projects/:id. Resources with api: false contribute no routes or OpenAPI entries.

List requests accept limit (default 20, maximum 100) and comma-separated orderBy, such as -createdAt,name. They return arrays. Retrieve returns a Read-validated record; create returns that record with status 201. Item update/delete return 204 without a body. Unknown query/body fields and nested writes are rejected. Each operation uses the trusted request subject/environment and its read/create/update/delete policy through QuerySets. Missing grants deny; object-policy update/delete remain denied until atomic object mutation support exists.

When at least one public operation exists, GET /api/openapi.json serves its generated OpenAPI 3.1 document. runtime.getOpenApiDocument() returns a copy after startup. Native Date and Temporal values use ISO strings; bigint uses decimal strings. Temporal input uses the runtime's Temporal implementation or explicit publicApi.temporal adapters compatible with schema generation. See [Phase 9](docs/phases/phase-09-public-api.md) for examples and limitations.
