# Nestrum

A Django-like TypeScript framework with strong conventions and runtime registration. **Phases 0–6 are implemented:** workspace tooling, explicit apps, lifecycle, named databases, Prisma fragment assembly/emission, metadata, generated Zod families, resource registration/composition, and QuerySets/managers.

## Development

Use Node.js 22.18+, 24, or 26+ within the ranges in package.json, and pnpm 12.6.0. TypeScript 7.0.2, Vitest 5.0.2, and Prisma CLI/provider facades 8.0.0-rc.13 are pinned in the workspace.

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm check
```

`pnpm test:watch` starts interactive watch mode. `pnpm check` runs tests, type checking, and builds. Core, Prisma, and Zod packages emit ESM JavaScript and declarations to their dist directories. Workspace tests/type checking resolve source through the nestrum-source condition; ordinary Node imports use compiled output.

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

compileModelMetadata({ database, provider, contract }) from @nestrum/prisma compiles emitted contract JSON. generateModelSchemas(metadata) from @nestrum/zod returns model/create/update/read/where/orderBy schemas and stable names. Object schemas support Zod .extend() composition. Runtime values follow Prisma codecs, including bigint, Date, and Temporal; JSON transport and resources arrive in later phases. See [Phase 4](docs/phases/phase-04-zod-generation.md) for usage and supported shapes.

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

Register definitions through app.resources or application.resources and supply generated families through application resourceModels (an array or loader). Startup validates every model and composes schemas before app hooks. Lookup uses application.resources.get('default.Project'). Public flags default to false and do not yet create routes. See [Phase 5](docs/phases/phase-05-resources.md) for a complete bootstrap example.

## QuerySets

Every registered resource exposes objects. Bind a Prisma 8 collection through ResourceModel.queryBackend using createPrismaQueryBackend from @nestrum/prisma/querysets. Queries chain filter(...).orderBy('-createdAt').limit(20) before all()/first()/get()/exists()/count(); writes use create/update/delete. Named managers compose the same immutable QuerySets. bindResourceQuerySets provides typed access such as Project.active when using a typed Prisma collection.

raw() returns the original Prisma collection and bypasses Nestrum validation, manager filters, and future automatic ABAC. Applications currently own clients and bindings; Mongo count requires a database-count callback. See [Phase 6](docs/phases/phase-06-querysets.md) for usage, semantics, and provider limitations.
