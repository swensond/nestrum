# Phase 5 — Resource System

## Status

Complete

## Goal

Register metadata-driven resources backed by validated Prisma models and generated Zod families.

## Scope

- defineResource, ResourceRegistry, typed resource errors, and application/app registration.
- Default and named database identities, model resolution, duplicate rejection.
- Composition of all six generated schema families.
- Public operation flags explicitly opt in; absent api and api: false disable every operation.
- Resource validation before configure/ready hooks during startup.

## Out of Scope

Clients/connections, QuerySets/managers, ABAC, HTTP/OpenAPI routes, admin registration, static model catalogs, and schema source generation.

## Architecture Decisions

Core owns shared metadata and resource types and depends directly on Zod 4.6.5. Prisma retains compilation and re-exports the metadata types, preserving Phase 4 imports. The Zod generator retains a one-way dependency on Prisma; core imports neither generator package. This avoids a package cycle while allowing typed composition callbacks and runtime schema checks. See [ADR 0006](../decisions/0006-resource-bootstrap-boundary.md).

Application.start initializes resources before any app hook. An optional resourceModels loader receives the application so it can emit contracts from the installed app graph without a second application instance. Core performs no filesystem/process work. Automatic contract emission without application configuration is still later lifecycle work.

## Implementation

Definitions are copied/frozen by defineResource. Database defaults to default; canonical identity is database.model. Invalid identifier segments, malformed API maps, nonboolean/unknown operation flags, and invalid schema composition maps fail with ResourceError. Normalized API maps always contain list/retrieve/create/update/delete booleans.

Apps declare resources: [ResourceDefinition]. Application configuration may also declare resources. Root resources register first, followed by app resources in topological app order and each app's declaration order. Duplicate identities and unregistered databases fail during application construction. The same model name in different databases is allowed.

ResourceRegistry.initialize accepts generated schema families carrying metadata. It verifies model identities/providers against configured databases and checks that all six schemas are present. Duplicate model families fail. Every declared resource must resolve to a compiled model; a same-named model in another database is insufficient. Metadata and untouched schemas are inherited directly.

Schema composers execute once per family during initialization, receiving the generated baseline. Object families return a ZodObject; Where returns a ZodType. Ordinary extend/refine/omit composition is supported. Composition failures preserve the original cause and identify resource/family. Callback code is trusted application code; no ancestry or field-preservation rule is enforced, and callbacks can deliberately return unrelated schemas. There is no separate replacement API.

The registry publishes its immutable ordered result only after all resources resolve and compose successfully. Lookup before initialization fails explicitly. get(identity), has(identity), and all() expose registered resources. Successful initialization cannot be repeated. Failed initialization publishes no partial resources.

Application resourceModels accepts a precompiled array or a synchronous/asynchronous loader returning one. Arrays are snapshotted at construction. Loaders are awaited before initialization; load/validation failures prevent all configure/ready/shutdown hooks from running and leave the application failed. Hook context includes resources alongside application/apps/databases. Applications without resources or a loader initialize an empty registry without changing existing hook ordering.

## Public API

Core exports defineResource, ResourceRegistry, ResourceError, ResourceConfig, ResourceDefinition, RegisteredResource, ResourceApi/ResourceApiOperation, ResourceModel, ResourceSchemaFamily, ResourceSchemaComposers, and shared model/field/relation/scalar metadata types.

```ts
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { defineApp, defineApplication, defineResource } from '@nestrum/core';
import type { ResourceModel } from '@nestrum/core';
import { compileModelMetadata, prismaDatabase } from '@nestrum/prisma';
import { generatePrismaContracts } from '@nestrum/prisma/node';
import { generateModelSchemas } from '@nestrum/zod';

const ProjectResource = defineResource({
    model: 'Project',
    api: { list: true, retrieve: true },
    schemas: {
        create(schema) {
            return schema.extend({ name: z.string().min(3) });
        }
    }
});
const ArticleResource = defineResource({ database: 'documents', model: 'Article', api: false });

const application = defineApplication({
    databases: {
        default: prismaDatabase({ provider: 'postgresql', connection: 'postgresql://localhost/nestrum' }),
        documents: prismaDatabase({ provider: 'mongodb', connection: 'mongodb://localhost/nestrum_documents' })
    },
    apps: [
        defineApp({ name: 'projects', prisma: { default: ['src/apps/projects/prisma'] }, resources: [ProjectResource] }),
        defineApp({ name: 'articles', prisma: { documents: ['src/apps/articles/prisma'] }, resources: [ArticleResource] })
    ],
    async resourceModels(application) {
        const generated = await generatePrismaContracts(application, { rootDir: process.cwd(), outputDir: '.nestrum/contracts' });
        const models: ResourceModel[] = [];
        for (const contract of generated.contracts) {
            const metadata = compileModelMetadata({
                database: contract.database,
                provider: contract.provider,
                contract: JSON.parse(await readFile(contract.contractPath, 'utf8'))
            });
            models.push(...metadata.map((model) => generateModelSchemas(model)));
        }

        return models;
    }
});
await application.start();
const project = application.resources.get('default.Project');
project.schemas.create.parse({ name: 'Example', /* other required model fields */ });
await application.shutdown();
```

The last parse call illustrates lookup; supply actual required fields for the app's Prisma model. Alternatively pass a precompiled resourceModels array. Families returned by generateModelSchemas are structurally compatible with ResourceModel; no copying/redeclaration of fields is needed.

Standalone validation, suitable for an application-owned build check:

```ts
const resources = new ResourceRegistry([ProjectResource], application.databases);
resources.initialize(precompiledModels);
```

Application owns initialization of application.resources; use a separate registry for standalone validation. Registered resources expose model/database/identity/api/metadata/schemas. Definition schema callbacks live on the definition; the registered resource exposes resolved schemas. Phase 6 adds manager factories to ResourceDefinition and resolved managers to RegisteredResource.

## Files / Packages Changed

- @nestrum/core: resource feature module, shared metadata types, application/app/bootstrap/context integration, Zod dependency, web-standard DOM declarations for Zod's URL types.
- @nestrum/prisma: compatible shared metadata type re-exports; compilation behavior unchanged.
- Core resource tests and Zod real-emission resource integration test.
- Workspace lockfile, README/status indexes, architecture/MVP, Phase 4 follow-ups, glossary, and ADR 0006.

## Tests

Coverage includes frozen definitions/config snapshots, explicit API flags, malformed definitions, named/default identities, duplicate resources/models, missing models, provider/database mismatch, all six composers, inherited schema references, strict unknown input handling through generated schemas, invalid composer results/errors, atomic registration failure, hook/context ordering, model-loader failure, no-model default denial, registration array snapshots, and SQL/Mongo real-emission integration.

## Acceptance Criteria

- [x] Valid resources register
- [x] Missing Prisma model fails bootstrap; standalone build validation is available
- [x] Database defaulting works
- [x] Named database resources work
- [x] Schema composition works
- [x] Public API stays disabled unless explicitly enabled
- [x] Documentation is updated

## Validation

```bash
pnpm install --frozen-lockfile
pnpm check
```

Validated with Node 26.10.0 and pnpm 12.6.0. Full validation runs tests, type checking, and builds: 168 tests in seven files pass, along with all three package builds. Compiled ESM resource/bootstrap imports and Markdown references also pass.

## Known Limitations

Prisma model names are strings resolved at startup; the compiler cannot statically reject nonexistent names without a generated model catalog. Callback results have dynamic field types inherited from Phase 4. An explicit model family array/loader is required for declared resources; core does not automatically discover or emit contracts. Incoming families/metadata should come from the Phase 4 compiler/generator; core validates identity/provider/schema shape rather than revalidating every metadata field.

API flags are registration metadata only; no routes or authorization exist yet. api: false marks a normal resource with all public operations disabled; actual admin registration arrives later. Application callbacks may customize schemas in ways that change ORM compatibility, so the application owns such deviations. Date/bigint/Temporal remain runtime values, not JSON transport schemas.

## Follow-Ups

Phase 6 now introduces QuerySets and managers using registered resources. Phase 7 adds ABAC; Phase 9 consumes opt-in operation flags for actual routes. Later lifecycle work consolidates built-in emission/bootstrap. Static catalogs/schema source generation remain deferred; no post-MVP implementation was added here.

## Completion Notes

Phase 5 is complete. Resources inherit real metadata and schemas, support named databases and composition, fail on missing models before hooks, and keep every public operation opt-in. No QuerySets, HTTP routes, or admin subsystem was introduced.
