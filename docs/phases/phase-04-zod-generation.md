# Phase 4 — Prisma Metadata Compiler and Framework-Owned Zod

## Status

Complete

## Goal

Compile Prisma 8 contracts into Nestrum model metadata and baseline Zod schema families.

## Scope

- Deterministic, immutable ModelMetadata, FieldMetadata, and RelationMetadata.
- Model, Create, Update, Read, Where, and OrderBy runtime Zod families.
- Strings, integers/numbers, bigint, boolean, dates/datetimes, enums, nullability, optional fields, and scalar arrays.
- Actual PostgreSQL and MongoDB emitted contracts, including mapped SQL storage names and mutation defaults.
- Explicit PostgreSQL compatibility authoring for the frozen MVP model.

## Out of Scope

Resources, clients/connections, QuerySets, ABAC, HTTP serialization, OpenAPI, admin, nested writes, Select/Include/Cursor/Aggregate, and generated TypeScript schema source files.

## Architecture Decisions

Prisma's emitted schemaVersion 1 domain/storage/execution IR is the compiler input. No DMMF assumptions or handwritten PSL interpretation. Codec identifiers determine runtime representations; Temporal, JavaScript Date, and ISO strings remain distinct. See [ADR 0005](../decisions/0005-metadata-and-runtime-schemas.md).

Runtime schema families are scoped by canonical model identity. Object schemas support ordinary Zod composition. Unknown codecs fail with a coded PrismaMetadataError and field identity. Unsupported field kinds do not become permissive schemas.

Native authoring remains default. generatePrismaContracts accepts authoring: { database: 'prisma7' } for PostgreSQL, using the official prisma7Schema adapter. A contributed datasource block specifying postgresql is required in this mode; place it in one database fragment. Neither mode rewrites app fragments. MongoDB compatibility authoring is rejected before emission.

## Implementation

compileModelMetadata validates contract envelopes and provider matching, walks namespaces/models/fields in sorted order, and returns frozen metadata. Repeated model names across namespaces fail because canonical identities omit physical namespaces. Field metadata carries codec/kind, nullability, optionality, array shape, primary-key membership, create/update default flags, and enum values. Relations carry name, target identity, cardinality, nullability, and local/target fields.

SQL primary keys and storage defaults resolve through mapped table/column names. Execution defaults also refer to physical storage names. Mongo required fields come from the collection validator; native @map("_id") emits the domain name _id, which Nestrum preserves. Nullable Mongo fields can be absent; nullable SQL read fields must be present with a value or null.

Schema behavior:

- Model and Read validate scalar records with strict unknown-key rejection. Relations are separate metadata and absent from all six schema shapes.
- Create makes optional fields, nullable fields, and fields with create defaults omittable. Defaults are not generated or materialized by Zod; Prisma remains responsible for them. A caller may supply a defaulted field explicitly.
- Update permits partial scalar records, including an empty object; all primary-key fields are excluded. Generated timestamps remain overridable at this baseline layer. Resource-level composition can tighten inputs later.
- Where supports field equality, scalar in/notIn/not and comparisons, text contains/startsWith/endsWith, array equals/has/hasEvery/hasSome/isEmpty, and recursive AND/OR/NOT. Values retain the correct codec representation. No relation filters. Fields named AND, OR, or NOT fail schema generation because they conflict with logical operators.
- OrderBy accepts field names with asc/desc. Query execution/provider restrictions are the responsibility of later QuerySet integration.

Integer schemas enforce 16/32-bit codec ranges, bigint enforces signed 64-bit range, dates reject invalid dates, numbers reject nonfinite values, and Mongo ObjectId strings require 24 hexadecimal characters. ISO date/date-time strings use Zod ISO validation. Enum values and array elements are validated without coercion.

Temporal schemas validate branded objects using the selected constructor's prototype methods. Supply a Temporal implementation explicitly or install it on globalThis when the runtime lacks it. No polyfill is imported or global state changed by framework runtime code; the polyfill dependency is test-only.

## Public API

Portable @nestrum/prisma exports compileModelMetadata, PrismaMetadataError, CompileMetadataOptions, ModelMetadata, FieldMetadata, RelationMetadata, and ScalarKind. The existing Node generator exposes the authoring option through GeneratePrismaOptions.

@nestrum/zod exports generateModelSchemas, ModelSchemas, and SchemaGenerationOptions:

```ts
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { compileModelMetadata } from '@nestrum/prisma';
import { generateModelSchemas } from '@nestrum/zod';

const models = compileModelMetadata({
    database: generatedContract.database,
    provider: generatedContract.provider,
    contract: JSON.parse(await readFile(generatedContract.contractPath, 'utf8'))
});
const project = models.find((model) => model.identity === 'default.Project');
if (!project) {
    throw new Error('Missing Project model.');
}
const schemas = generateModelSchemas(project);
const ProjectCreateSchema = schemas.create;
const ProjectReadSchema = schemas.read;
const customized = ProjectCreateSchema.extend({ name: z.string().min(3) });
```

Families expose metadata, names, model, create, update, read, where, and orderBy. names supplies ProjectModelSchema, ProjectCreateSchema, ProjectUpdateSchema, ProjectReadSchema, ProjectWhereSchema, and ProjectOrderBySchema labels; these are runtime family labels, not emitted module exports. Keep families indexed by metadata.identity when databases share a model name.

For a runtime without native Temporal:

```ts
import { Temporal } from '@js-temporal/polyfill';

const schemas = generateModelSchemas(project, { temporal: Temporal });
```

Applications using that example supply their own polyfill dependency. JavaScript Date presets do not need Temporal.

## Files / Packages Changed

- @nestrum/prisma: metadata types/compiler, portable exports, package alias, explicit generation authoring option.
- New @nestrum/zod: generation API and integration tests; Zod 4.6.5, test-only Temporal polyfill 0.5.1.
- Workspace lockfile and Vitest project list.
- README, architecture, MVP/status indexes, Phase 3 compatibility notes, ADR/glossary, and deferred-work documentation.

## Tests

Real offline emission covers SQL and Mongo models, enum values, arrays, mapped table/column names, relation metadata, storage and execution defaults, and the exact frozen MVP fields through the official compatibility adapter. Tests check deterministic/frozen metadata, malformed envelopes, unknown codecs, provider mismatches, namespace ambiguity, all families, composition, valid/invalid fields, unknown keys, nested-write rejection, primary-key updates, recursive filters, ordering, Temporal injection, forged prototypes, and missing Temporal implementations.

## Acceptance Criteria

- [x] Metadata compiles deterministically
- [x] Generated Zod schema families exist
- [x] Valid values pass
- [x] Invalid values fail
- [x] SQL and Mongo-oriented representative models are tested
- [x] Documentation is updated

## Validation

```bash
pnpm install --frozen-lockfile
pnpm check
```

Validated on Node 26.10.0 with pnpm 12.6.0. The full check runs pnpm test, pnpm typecheck, and pnpm build: 140 tests across six files and all three package builds pass. Compiled ESM imports and local Markdown references were also checked.

## Known Limitations

Compilation/generation remains explicit. Phase 5 can invoke it through an application-supplied resourceModels loader before app hooks; core still does not automatically emit contracts. Schemas are runtime objects with dynamic field shapes, not statically generated per-model TypeScript declarations. Read schemas validate Prisma runtime values; JSON transport for bigint, Date, and Temporal remains future API work.

Only the documented codec allowlist is supported. Decimal, JSON/BSON, binary, embedded/composite models, arbitrary codec extensions, database checks, and full storage/type-parameter constraints are not inferred. Native rc.13 has upstream authoring limitations: SQL Boolean @default(true) fails native emission and Mongo @default is unsupported. Storage defaults that successfully emit and mutation presets are supported by the compiler. Compatibility authoring maps legacy cuid() to Prisma's cuid2 generator and DateTime to Temporal.PlainDateTime; it does not promise legacy generated-ID bytes or Date objects.

The Where family is a validated baseline, not a promise that every operator/order combination executes on every provider. QuerySets will adapt or reject provider-specific operations. No live database behavior has been proven here.

## Follow-Ups

Phase 5 now registers resources against this metadata and composes these schemas. Shared metadata types move to core with compatible Prisma re-exports. Phase 6 integrates typed contracts and provider operations; Phase 9 introduces transport schemas/serialization. Later lifecycle work integrates generation at bootstrap. Additional field families beyond the initial scalar scope are recorded in [post-MVP](../post-mvp.md).

## Completion Notes

Phase 4 is complete. Nestrum consumes real Prisma 8 IR and owns all six runtime schema families. The frozen MVP authoring example now emits and validates through an explicit official PostgreSQL adapter; full resource/runtime integration remains incomplete. No resources, QuerySets, or HTTP systems were introduced.

Current integration evidence (2026-09-30): [Phase 16](phase-16-integration.md) now verifies real Docker PostgreSQL/Mongo contracts, migrations, resources, auth, admin forms/browser flows, and shutdown. Earlier phase-specific fixture results remain historical evidence. Atomic object-policy writes still deny and remain an unmet required MVP follow-up.
