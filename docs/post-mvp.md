# Explicitly deferred work

These features are outside the frozen MVP unless a small supporting abstraction is necessary for an included capability. Record newly deferred work here as implementation proceeds.

## Data and database

- Advanced cross-database orchestration and distributed transactions.
- Mongo collection compression and custom physical collection storage options.
- PostgreSQL extensions, partitioning, and custom physical indexes not represented by Prisma.
- GridFS and blob storage.
- Advanced aggregate APIs; generated Select/Include/Cursor/Aggregate schema families.
- Public select/include and nested writes.

## Framework

- Event bus, jobs, queues, outbox, sagas, caching, and feature flags.
- Soft delete framework and automatic audit history.
- Full plugin ecosystem, code generators, and publishing automation.
- CLI scaffolding and development server commands beyond the MVP database commands.

## Admin

- Polished visual design, custom pages, dashboards/widgets, and full theme system.
- Inline related editing, bulk actions, and advanced search.
- Rich text editors, file uploads, and relation pickers beyond basic needs.

## Runtime and API

- Formal Bun, Deno, and Cloudflare support.
- Provider-specific optimizations outside Node.
- GraphQL, advanced relationship expansion, generated external SDKs, and public arbitrary Prisma expressions.
- Field-level ABAC is excluded from the MVP; any later adoption requires revisiting stable response and admin contracts.
- Social auth providers, MFA, email verification delivery, account linking, and broader Better Auth plugin coverage.

## Implementation follow-ups

Phase 4 leaves Decimal, JSON/BSON, binary, composite/embedded fields, arbitrary codec extensions, and complete storage-constraint inference beyond the initial scalar MVP scope. Static generated per-model schema source files are also deferred; runtime families provide the MVP baseline. See [Phase 4](phases/phase-04-zod-generation.md). Typed QuerySet integration shipped in Phase 6; JSON scalar transport shipped in Phase 9.

Phase 9 leaves composite-key HTTP item routes, configurable route aliases/English irregular inflection, advanced pagination/filtering, interactive documentation UI, and complete OpenAPI expression of custom/native validators deferred. Atomic object-policy mutation support, automatic client ownership, and live database proof remain required MVP follow-ups, not post-MVP deferrals. Scope-based public writes work now; per-object write policies continue to deny.
