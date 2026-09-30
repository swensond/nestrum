# Nestrum

A Django-like TypeScript framework with strong conventions and runtime registration. **Phases 0–14 are implemented:** workspace tooling, explicit apps, lifecycle, named databases, Prisma fragment assembly/emission, metadata, generated Zod families, resource registration/composition, QuerySets/managers, default-deny ABAC, a Hono/InferDI runtime, opt-in public CRUD with OpenAPI, framework-owned Better Auth, a private session/ABAC-protected admin backend, and a prebuilt metadata-driven admin shell with generic CRUD, custom widgets, and authorized per-record actions.

## Development

Use Node.js 22.18+, 24, or 26+ within the ranges in package.json, and pnpm 12.6.0. TypeScript 7.0.2, Vitest 5.0.2, and Prisma CLI/provider facades 8.0.0-rc.13 are pinned in the workspace.

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm check
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
    databases: {
        default: prismaDatabase({ provider: 'postgresql', connection: 'postgresql://localhost/nestrum' }),
        documents: prismaDatabase({ provider: 'mongodb', connection: 'mongodb://localhost/nestrum_documents' })
    }
});
await application.start();
await application.shutdown();
```

The database configuration and app graph validate when the application is defined. All apps configure in dependency order before any ready hook runs; shutdown reverses that order. See [Phase 1](docs/phases/phase-01-application.md) for lifecycle states and failure behavior.

Every application must configure default. Access definitions through application.databases.get() or get('documents'); has(name) checks registration. Hooks receive the same databases registry. modelIdentity('Project') returns default.Project; modelIdentity('Article', 'documents') returns documents.Article.

Phase 2 registers immutable settings without creating Prisma clients or connecting to databases. See [Phase 2](docs/phases/phase-02-databases.md) for configuration rules.

## Prisma contracts

Apps explicitly contribute files or recursively discovered directories to named databases:

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

This offline step emits contract.json and contract.d.ts for each contributed database in a fresh run directory. It does not connect or migrate. Native Prisma 8 authoring is the default. PostgreSQL can opt into authoring: { default: 'prisma7' } for legacy syntax through the official adapter. See [Phase 3](docs/phases/phase-03-prisma-contracts.md) for artifacts and [Phase 4](docs/phases/phase-04-zod-generation.md) for metadata, schema generation, and compatibility details.

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

raw() returns the original Prisma collection and bypasses Nestrum validation, manager filters, and automatic ABAC. Applications currently own clients and bindings; Mongo count requires a database-count callback. See [Phase 6](docs/phases/phase-06-querysets.md) for usage, semantics, and provider limitations.

## Authorization

Register policies through application policies or app policies. Missing policies, actions, and QuerySet authorization contexts deny. Policies are copied/frozen before app hooks; hooks expose authorization.

```ts
import { allow, definePolicy, deny, eq } from '@nestrum/core';

const ProjectPolicy = definePolicy({
    resource: 'default.Project',
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
    database: 'identity',
    baseURL: 'https://app.example.com',
    secret: process.env.BETTER_AUTH_SECRET!,
    extend: { user: { timezone: field.string().optional().input() } },
    prisma: ({ database }) => configuredPrismaAuthCollections(database)
});
```

`auth.database` selects the configured store. Nestrum contributes protected User, Session, Account, and Verification contracts and owns the Better Auth Prisma 8 adapter. Email/password, session, logout, and session retrieval are available under `/api/auth`. Valid sessions become ABAC subjects; absent, expired, or invalid sessions are anonymous. Domain profile data remains separate from the core auth user. See [Phase 10](docs/phases/phase-10-auth.md).

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

Use createRuntimeContainer(application) to register typed services and provide a di.container/createScope pair; a supplied root remains application-owned. The runtime exposes a Fetch handler; the application owns its TCP listener. See [Phase 8](docs/phases/phase-08-hono-runtime.md) for service registration, error contracts, and scope ownership.

## Public API

The example Project resource above exposes GET /api/projects. Enable retrieve/create/update/delete individually to add GET /api/projects/:id, POST /api/projects, PATCH /api/projects/:id, and DELETE /api/projects/:id. Named databases use /api/<database>/<plural-model>. Resources with api: false contribute no routes or OpenAPI entries.

List requests accept limit (default 20, maximum 100) and comma-separated orderBy, such as -createdAt,name. They return arrays. Retrieve returns a Read-validated record; create returns that record with status 201. Item update/delete return 204 without a body. Unknown query/body fields and nested writes are rejected. Each operation uses the trusted request subject/environment and its read/create/update/delete policy through QuerySets. Missing grants deny; object-policy update/delete remain denied until atomic object mutation support exists.

When at least one public operation exists, GET /api/openapi.json serves its generated OpenAPI 3.1 document. runtime.getOpenApiDocument() returns a copy after startup. Native Date and Temporal values use ISO strings; bigint uses decimal strings. Temporal input uses the runtime's Temporal implementation or explicit publicApi.temporal adapters compatible with schema generation. See [Phase 9](docs/phases/phase-09-public-api.md) for examples and limitations.
