# Frozen MVP scope

## Status

Not complete. Phases 0–12 are complete; Phases 13–16 are not started. Workspace, app lifecycle, named databases, offline SQL/Mongo contract assembly/emission, immutable metadata, and runtime Zod families are implemented. Resource registration/composition and pre-hook model validation are implemented. Immutable QuerySets, managers, and supplied-client Prisma adapters are implemented. Default-deny ABAC, scoped QuerySets, object decisions, and custom actions are implemented. The Fetch-based Hono/InferDI runtime now generates opt-in public CRUD, JSON scalar transport, and OpenAPI. Item mutations return 204 and retain object-policy denial. Framework-owned Better Auth now provides protected contracts, a Prisma 8 adapter, email/password sessions, and ABAC subject mapping. The private admin backend and metadata-driven Svelte admin shell are implemented. Generic admin CRUD widgets, extensibility, automatic database client integration, lifecycle hardening, and live integration remain later work. The frozen scope below remains the full MVP target.

## Included

- Explicit Django-style apps, dependency validation, deterministic lifecycle, and reverse shutdown.
- Required `default` and named Prisma 8 databases; canonical `<database>.<model>` identities; single-database transactions.
- App-owned multi-file Prisma fragments, per-database assembly, metadata compilation, and framework-owned Zod generation.
- Model/Create/Update/Read/Where/OrderBy schemas with resource-level composition and bootstrap model validation.
- Immutable QuerySets, irreplaceable `objects`, named managers, Django-style evaluation, and explicit `raw()` Prisma access.
- Default-deny ABAC, arbitrary actions, database collection scopes, and object authorization; no field-level ABAC.
- Hono and InferDI request scopes, cleanup, portable core design, and consistent errors.
- Explicitly enabled public CRUD and generated OpenAPI; admin-only resources have no public routes.
- Fundamental Better Auth integration with Nestrum-owned Prisma 8 adapter and protected/extensible models, selected auth database, and session-to-subject mapping.
- Private admin metadata and CRUD API requiring session, `admin.access`, and same-origin access by default.
- Prebuilt Svelte 5/SvelteKit admin, generic routes/navigation/CRUD, custom fields, and ABAC-backed custom actions.
- Nestrum database CLI (`db generate`, `db migrate`, `db status`), lifecycle hardening, and provider extension seams.
- SQL and MongoDB integration proof, a public resource and an admin-only resource, and durable phase documentation.

## Resource definition of done

An app contributes this Prisma fragment:

```prisma
model Project {
  id          String   @id @default(cuid())
  name        String
  description String?
  status      String
  ownerId     String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

The example above remains frozen MVP intent. Phase 4 supports emission via authoring: { default: 'prisma7' } using the official PostgreSQL compatibility adapter and a separate datasource fragment. It maps cuid() to cuid2 and DateTime to Temporal.PlainDateTime. Native mode still rejects legacy @updatedAt; see [Phase 4](phases/phase-04-zod-generation.md) for actual representations and limitations.

Then defines a resource (registration, managers, and public routes are implemented through Phase 9):

```ts
const ProjectResource = defineResource({
    model: 'Project',
    api: {
        list: true,
        retrieve: true,
        create: true,
        update: true,
        delete: true
    }
});
```

With appropriate app, policies, database, and admin registration, the framework provides contract assembly, model validation, generated Zod, `Project.objects`, custom managers, immutable QuerySets, `raw()`, ABAC/scopes/arbitrary actions, Hono CRUD, OpenAPI, auth integration, admin API, generic Svelte CRUD, admin customization, lifecycle, and database CLI.

Adding an ordinary resource must require no manual Hono route, OpenAPI definition, or resource-specific Svelte page. Public API remains opt-in; admin-only resources are ordinary resources with `api: false`.

## Integration proof

Target `default.Project` in PostgreSQL and `documents.Article` in MongoDB, subject to verified Prisma 8/runtime capabilities in the integration environment. Both have distinct managers/policies, generated Zod, and admin access; only one exposes public CRUD. Verify app dependencies and configurable auth placement. If provider support blocks a target, record the blocker and leave the unmet acceptance criterion open.

## Completion gate

All phase implementations and acceptance criteria must be met; `pnpm test`, `pnpm typecheck`, `pnpm check`, and applicable builds must pass. Svelte phases additionally run `svelte-check-native`; high-level integration may use Playwright. All phase records must describe the actual repository, and deferred work must be captured in [post-MVP](post-mvp.md). Mark this document complete only after Phase 16 passes.

See [phase records](phases/README.md) for phase-specific scope and [architecture](architecture.md) for durable contracts.
