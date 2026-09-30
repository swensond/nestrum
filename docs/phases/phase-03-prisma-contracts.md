# Phase 3 — Prisma 8 Multi-File Contract Assembly

## Status

Complete

## Goal

Allow registered apps and framework modules to contribute Prisma fragments independently per database, with real Prisma 8 contract generation.

## Scope

- Declare app-owned file/directory contributions by database.
- Collect fragments in app dependency order and recursively discover sorted regular .prisma files.
- Assemble separate contracts for independently configured databases.
- Emit native Prisma 8 contract JSON/declarations offline.
- Reject duplicate files, duplicate/conflicting declarations, invalid sources, and unresolved references with provenance.

## Out of Scope

Resources, QuerySets, metadata/Zod compilation, live clients, migrations, database connections, cross-database relation emulation, and automatic full bootstrap integration.

## Architecture Decisions

Core owns immutable contribution metadata; Node filesystem/process work lives in @nestrum/prisma/node. The root Prisma factory entry remains portable. Validation uses the real Prisma emitter instead of a second PSL parser.

Public CLI and PostgreSQL/MongoDB facades are pinned to 8.0.0-rc.13. This installed version accepts one native contract file, while newer docs describe globs. Nestrum assembles a generated contract.prisma per database from separate app-owned files. See [ADR 0004](../decisions/0004-prisma-contract-assembly.md).

Each generation uses a new run directory to prevent stale-file inclusion and preserve previous output. Configs omit connections and disable telemetry. Source paths and provider imports are absolute, supporting outputs outside the workspace; generated configs must be regenerated if packages are relocated.

## Implementation

AppDefinition adds prisma: { database: [fileOrDirectoryPaths] }. defineApp/AppRegistry copy and freeze maps and path lists. Malformed path lists fail at definition; unknown target databases fail during assembly.

assemblePrismaContracts(application, { rootDir }) returns frozen database/provider/source/fragment snapshots. Apps run in dependency order; database results follow registry order; files within directories are sorted recursively. Explicit files are supported. Sources retain canonical paths and owning app names. Missing/empty/invalid inputs and duplicate physical files within a database produce coded errors. Reusing a file under different database identities is permitted.

generatePrismaContracts(application, { rootDir, outputDir, timeoutMs? }) assembles, stages copied fragments, writes a first-line // use prisma-8 header and provenance into each combined source, creates an emit-only config, and runs the pinned Prisma CLI with argument arrays and bounded output/timeout. It returns a frozen generation result only after every contributed database emits successfully.

Generated artifacts are contract.prisma, copied fragments, prisma.config.mjs, contract.json, and contract.d.ts. No connection setting is written and no database is contacted. Databases without app contributions are omitted; an entirely empty generation fails. Native diagnostics plus original app/path owners identify semantic conflicts. Failed run directories are retained for diagnostics rather than automatically deleting output.

Application.start() remains the app lifecycle. Generation is currently explicit and must be called before starting when contracts are needed; full pipeline integration comes later.

## Public API

```ts
import { defineApp, defineApplication } from '@nestrum/core';
import { prismaDatabase } from '@nestrum/prisma';
import { assemblePrismaContracts, generatePrismaContracts } from '@nestrum/prisma/node';

const application = defineApplication({
    databases: {
        default: prismaDatabase({ provider: 'postgresql', connection: 'postgresql://localhost/nestrum' }),
        documents: prismaDatabase({ provider: 'mongodb', connection: 'mongodb://localhost/documents' })
    },
    apps: [
        defineApp({
            name: 'projects',
            dependsOn: ['users'],
            prisma: { default: ['src/apps/projects/prisma'] }
        }),
        defineApp({
            name: 'users',
            prisma: { default: ['src/apps/users/prisma/user.prisma'] }
        }),
        defineApp({
            name: 'articles',
            prisma: { documents: ['src/apps/articles/prisma'] }
        })
    ]
});

const assembled = await assemblePrismaContracts(application, { rootDir: process.cwd() });
const generated = await generatePrismaContracts(application, {
    rootDir: process.cwd(),
    outputDir: '.nestrum/contracts'
});
await application.start();
```

A native MongoDB fragment can use:

```prisma
model Article {
    id ObjectId @id @map("_id")
    title String
}
```

The Node entry exports assemblePrismaContracts, generatePrismaContracts, PrismaContractError, and types ContractApplication, PrismaFragment, PrismaContract, AssemblePrismaOptions, GeneratePrismaOptions, GeneratedPrismaContract, PrismaGeneration. Default emission timeout is 30 seconds per database; timeoutMs can override it with a positive finite value.

PrismaContract contains database, provider, source, and fragments ({ app, path, content }). GeneratedPrismaContract additionally exposes sourcePath, configPath, contractPath, and typesPath. PrismaGeneration exposes directory and contracts.

## Files / Packages Changed

- Core app types, definition snapshots, and registry error codes.
- packages/prisma/src/contracts/: types, errors, discovery/assembly, and generation.
- packages/prisma/src/node.ts and package exports: Node-only public boundary.
- packages/prisma/package.json and pnpm-lock.yaml: pinned Prisma CLI/provider dependencies.
- packages/prisma/tsconfig.json: Node types for the Node entry.
- packages/prisma/tests/contracts.test.ts and fixtures/apps/: real SQL/Mongo assembly/emission fixtures.
- package.json: Node minimum raised to 22.18 to match Prisma CLI.
- pnpm-workspace.yaml: explicit pinned build-script decisions.
- .gitignore: .nestrum generated output.
- README, glossary, architecture, MVP, phase/index records, and contract-assembly ADR.

## Tests

21 new cases cover multi-app/named-database assembly, recursive ordering, explicit files, immutable snapshots, absent contributions, missing/invalid/empty paths, duplicate canonical-path ownership, reuse across databases, symlink handling, malformed path lists, real SQL/Mongo emission, exact model sets, deterministic repeated JSON output, native duplicate/conflicting declarations, unresolved references, empty generation, unsupported legacy @updatedAt, and output-file preservation. Existing tests remain green; final total is 103 across five files.

The SQL fixture combines users and projects apps into User, Project, and ProjectMember, with a relation spanning files/apps. The Mongo fixture contributes Article separately through the articles app. Fake unused connection settings prove emission is offline.

## Acceptance Criteria

- [x] Two apps contribute models to default
- [x] Another app contributes models to documents
- [x] Emitted contracts contain exactly expected models
- [x] Duplicate/conflicting definitions fail clearly
- [x] Documentation and final validation are complete

## Validation

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm check
pnpm build
```

Passed on 2026-09-29 with Node v26.10.0, pnpm 12.6.0, TypeScript 7.0.2, Vitest 5.0.2, and direct Prisma CLI/facades 8.0.0-rc.13:

- pnpm install --frozen-lockfile passed for three workspace projects.
- pnpm test passed 103 tests across five files.
- pnpm typecheck passed source/tests/configuration checking.
- pnpm build emitted core and prisma ESM/declarations in dependency order.
- pnpm check passed after the final code/test changes.
- Compiled @nestrum/prisma/node exports emitted a real SQL contract via the installed CLI.
- SQL/Mongo fixtures emitted exactly the expected model sets, and repeated runs produced byte-identical JSON.
- All 17 phase records retain required headings; local links across 29 Markdown documents resolve.

The initial install stopped on ignored dependency build scripts. The explicit pinned esbuild allow and optional msgpackr-extract/workerd denies resolved installation. Generation tests required no database service.

## Known Limitations

Prisma 8 dependencies are release candidates. The installed rc.13 facade does not implement the glob input described by newer documentation, so Nestrum assembles generated per-database source. Native syntax is required; legacy generator/datasource blocks and unsupported attributes are not translated.

The exact frozen MVP example's @updatedAt and legacy cuid() syntax fail under the pinned native emitter. Phase 4 addresses authoring compatibility with an explicit official PostgreSQL adapter; see [Phase 4](phase-04-zod-generation.md). The full MVP runtime target remains incomplete. Native Mongo fixtures use ObjectId. No promise of live SQL/Mongo runtime behavior is made by offline emission.

Collection/assembly does not semantically validate definitions; generation does. Symlinks encountered while walking directories are skipped; explicit symlink contributions are rejected. Every declared path must resolve and contain regular .prisma input. Assembly is a snapshot and requires regeneration after source changes.

Generated configs contain machine-specific module/source paths. Repeated and failed runs remain in separate directories, and cleanup/publication is caller-managed until CLI lifecycle work. Successful artifacts are not automatically attached to Application or read at startup.

## Follow-Ups

Phase 4 now consumes contract IR, maps provider codecs/model metadata, and supports explicit official PostgreSQL compatibility authoring for the frozen MVP example. Later phases add live runtime clients and automatic pipeline integration; Phase 15 owns the public Nestrum DB CLI and hardens lifecycle/output management. No post-MVP feature was required.

## Completion Notes

Phase 3 is complete. The fragment/contract abstraction, real offline SQL/Mongo emission, focused tests, checks/builds, and documentation are implemented and validated. The pinned-emitter glob limitation is handled by generated per-database assembly. Phase 4 subsequently adds an explicit official compatibility authoring option; resources, QuerySets, and live databases remain out of scope.

Current integration evidence (2026-09-30): [Phase 16](phase-16-integration.md) now verifies real Docker PostgreSQL/Mongo contracts, migrations, resources, auth, admin forms/browser flows, and shutdown. Earlier phase-specific fixture results remain historical evidence. Atomic object-policy writes still deny and remain an unmet required MVP follow-up.
