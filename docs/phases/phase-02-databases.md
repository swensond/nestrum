# Phase 2 — Named Database Registry

## Status

Complete

## Goal

Introduce named Prisma-backed database definitions and a required default without contract generation or live database clients.

## Scope

- Add DatabaseRegistry, definition/configuration types, coded errors, and canonical model identity utility to core.
- Introduce @nestrum/prisma with prismaDatabase({ provider, connection }).
- Require application databases.default and expose the registry on application and hook context.
- Snapshot definitions, validate names/configuration, and reject duplicate entry names.
- Keep registry/factory portable and free of live Prisma runtime dependencies.

## Out of Scope

Contract discovery/assembly/generation, Prisma clients, connecting/disconnecting, provider adapters, transactions, resources, QuerySets, and cross-database relation/transaction emulation.

## Architecture Decisions

Core owns the explicit Prisma definition shape, because Prisma is foundational. Prisma depends on core; core does not import prisma. Factory and registry share definition validation. Registration validates eagerly during application construction before app hooks, matching the existing eager graph validation.

The provider contract currently recognizes postgresql and mongodb, the MVP integration targets. Definitions are configuration only; accepting a provider is not proof of live driver functionality. Prisma 8 uses provider-specific libraries and db.connection configuration; their integration is deferred to the corresponding phases.

Database/model identifiers are case-sensitive ASCII identifier segments without dots. Connections are opaque nonempty strings with no surrounding whitespace. The identity helper constructs database.model without performing model or database lookup.

See [ADR 0003](../decisions/0003-database-registration-boundary.md). Root tests/typecheck use the nestrum-source export condition; normal builds and Node imports retain dist exports.

## Implementation

DatabaseRegistry accepts named objects or readonly name/definition entry arrays. It validates every own entry, snapshots definitions into frozen values, and requires an own entry named default. A Map supports names that overlap object prototype properties. Entry arrays detect duplicates before data is collapsed into an object; JavaScript objects cannot preserve already overwritten duplicate keys.

The registry provides get(name = 'default'), has(name), and names(). Unknown lookup throws DATABASE_NOT_FOUND. Error types extend the existing AppError base. Definition validation rejects non-Prisma kinds, unsupported providers, and empty/non-string/surrounding-whitespace connections without echoing credentials.

ApplicationConfig now requires databases, whose default key is required by TypeScript. Application constructs the database registry before the app registry and includes it in the frozen hook context. No network access or database I/O occurs during definition or lifecycle execution.

## Public API

```ts
import { defineApp, defineApplication, modelIdentity } from '@nestrum/core';
import { prismaDatabase } from '@nestrum/prisma';

const application = defineApplication({
    databases: {
        default: prismaDatabase({
            provider: 'postgresql',
            connection: 'postgresql://localhost/nestrum'
        }),
        documents: prismaDatabase({
            provider: 'mongodb',
            connection: 'mongodb://localhost/nestrum_documents'
        })
    },
    apps: [
        defineApp({
            name: 'articles',
            configure({ databases }) {
                databases.get('documents');
            }
        })
    ]
});

application.databases.get(); // default definition
application.databases.has('documents'); // true
application.databases.names(); // ['default', 'documents']
modelIdentity('Project'); // default.Project
modelIdentity('Article', 'documents'); // documents.Article

await application.start();
await application.shutdown();
```

Core exports DatabaseRegistry, DatabaseRegistryError, validateDatabaseDefinition, modelIdentity, and the types DatabaseDefinition, DatabaseConfig, DatabaseEntry, PrismaProvider, ModelIdentity. Prisma exports prismaDatabase and PrismaDatabaseConfig.

DatabaseDefinition contains kind: 'prisma', provider, and connection. Names/model segments match a letter or underscore followed by letters, digits, or underscores. Definitions/names are readonly and frozen; caller-owned values remain mutable. Sharing one connection value across different names is permitted.

Missing default fails eagerly with DEFAULT_DATABASE_REQUIRED. Omitted/malformed configuration fails with INVALID_DATABASE_CONFIG; invalid names, duplicate entry names, and unknown lookups have distinct codes. Identity validation rejects invalid model/database segments; model existence remains Phase 5.

## Files / Packages Changed

- packages/core/src/database/: definition/config types, validation, registry, errors, and model identity.
- packages/core/src/application/: application configuration, registry ownership, and hook context.
- packages/core/src/index.ts, package.json, and tsconfig.json: exports, source condition, and #core cross-feature aliases.
- packages/core/tests/application.test.ts: database fixtures for existing lifecycle tests.
- packages/core/tests/databases.test.ts: registry, identity, and application integration tests.
- packages/prisma/: new private ESM package, factory, types, build config, and tests.
- pnpm-lock.yaml: workspace dependency link from prisma to core.
- tsconfig.json, vitest.config.ts, vitest.workspace.ts: source resolution and Prisma test project.
- README, architecture, MVP/index/phase records, database boundary ADR, and CONTEXT glossary.

No external runtime dependency was added during Phase 2. Phase 3 adds pinned Prisma dependencies and the separate @nestrum/prisma/node emission API; the database factory remains configuration-only.

## Tests

52 new cases cover default/named lookups, required default, unknown names, duplicate entries, immutable snapshots, own-entry handling, prototype-name safety, malformed configurations, provider/connection validation, canonical identity validation, database availability in every lifecycle hook, and public factory/application composition. Existing lifecycle and scaffold tests remain green (82 tests total across four files).

## Acceptance Criteria

- [x] Missing default fails bootstrap before app hooks
- [x] Named database lookup works
- [x] Canonical identity utility works
- [x] Duplicate/invalid configuration is rejected
- [x] Documentation and final validation are complete

## Validation

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm check
pnpm build
```

Passed on 2026-09-29 using Node v26.10.0, pnpm 12.6.0, TypeScript 7.0.2, and Vitest 5.0.2:

- pnpm install and pnpm install --frozen-lockfile passed with all three workspace projects.
- pnpm test passed 82 tests across four files and two package projects.
- pnpm typecheck passed, including source-condition package resolution and the required-default type assertion.
- pnpm build passed with core built before prisma and ESM/declarations emitted.
- pnpm check passed tests, typecheck, and build after the final code changes.
- Ordinary Node imports of compiled core/prisma exports passed named lookup, required-default rejection, identity construction, and app lifecycle smoke validation.
- All 17 phase records retain required headings; local links across 28 Markdown documents resolve.

The sandbox blocked registry DNS during frozen-install verification; the authorized installation succeeded using the shared pnpm store. No live database service was required or contacted.

## Known Limitations

Definitions do not create clients, validate provider-specific connection syntax/reachability, resolve environment variables, or check model existence. Applications resolve environment settings before passing connection strings. Phase 3 now pins Prisma 8.0.0-rc.13 and verifies offline SQL/Mongo contract emission; live client/provider behavior remains later work.

Already overwritten duplicate object keys cannot be detected; use low-level entry arrays when duplicate detection is needed before object construction. Databases cannot be added after registry construction. Only PostgreSQL/MongoDB definitions are supported at this stage. Source exports are for the private workspace and need review before publishing.

## Follow-Ups

Proceed to [Phase 3: Prisma 8 Multi-File Contract Assembly](phase-03-prisma-contracts.md). Add provider runtime/client lifecycle as needed by later phases; Phase 15 hardens disconnect and provider-extension behavior. No additional post-MVP capability was implemented or required.

## Completion Notes

Phase 2 is complete. Named definitions, required default, identity validation, public factory, lifecycle context integration, tests, builds, and documentation are implemented and validated. This phase introduces configuration registration only; Phase 3 is next.

Current integration evidence (2026-09-30): [Phase 16](phase-16-integration.md) now verifies real Docker PostgreSQL/Mongo contracts, migrations, resources, auth, admin forms/browser flows, and shutdown. Earlier phase-specific fixture results remain historical evidence. Atomic object-policy writes still deny and remain an unmet required MVP follow-up.
