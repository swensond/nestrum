# Architecture decisions

Use ADR-style records when future sessions need the reasoning for a durable decision. Routine implementation details belong in phase records. Each record should identify status, context, decision, consequences, and relevant references. User-approved locked architecture is summarized in [architecture](../architecture.md).

- [0001 — Workspace tooling](0001-workspace-tooling.md): TypeScript 7, ESM compilation, and current Vitest projects with the requested workspace filename.
- [0002 — Application lifecycle](0002-application-lifecycle.md): immutable app graphs, configure/ready barriers, lifecycle states, and failure cleanup.
- [0003 — Database registration boundary](0003-database-registration-boundary.md): Prisma-specific metadata in core, one-way package dependencies, and configuration-only named registration.
- [0004 — Prisma contract assembly](0004-prisma-contract-assembly.md): app fragment ownership, native validation, release-candidate compatibility, and generated artifact boundaries.

- [0005 — Metadata and runtime schema representations](0005-metadata-and-runtime-schemas.md): actual codec representations, canonical metadata, runtime generation, and explicit compatibility authoring.

- [0006 — Resource bootstrap and package boundaries](0006-resource-bootstrap-boundary.md): shared metadata ownership, cycle-free schema composition, and pre-hook resource validation.

- [0007 — QuerySets over Prisma 8 collections](0007-querysets-and-prisma-collections.md): fluent native adapters, typed manager access, terminal semantics, and explicit raw/client boundaries.

- [0008 — Authorization query boundary](0008-authorization-query-boundary.md): default-deny evaluation, action/operation binding, database scopes, and fail-closed object terminal restrictions.

- [0009 — HTTP runtime and scope ownership](0009-http-runtime-and-scope-ownership.md): Fetch boundary, typed request inputs, InferDI lifecycle, and bounded cleanup/draining.

- [0010 — Public API transport and mutation boundary](0010-public-api-transport-and-mutations.md): one enabled route plan, wire/native values, preserved item predicates, and bodyless scoped writes.

- [0011 — Framework-owned Better Auth boundary](0011-better-auth-boundary.md): selected-database contracts, adapter ownership, protected models, and session subjects.

- [0012 — Admin extension boundaries](0012-admin-extension-boundaries.md): ordinary ABAC action handlers and build-time widget registration shared by SSR/client.

- [0013 — Database workflow and lifecycle ownership](0013-database-workflow-and-lifecycle.md): named Prisma 8 command delegation, stable migrations, provider seams, and app/DI/database cleanup barriers.

- [0014 — Roles and staff management](0014-roles-and-staff-management.md): Better Auth admin-plugin roles, CLI-created administrators, admin-managed staff, and role-based policies.

- [0015 — First-class API keys](0015-api-keys.md): Better Auth's API-key plugin behind server-side calls, `X-API-Key` transport, explicit key subjects, scopes plus ABAC, and admin-managed keys.

- [0016 — Typed boolean feature flags](0016-feature-flags.md): source-declared flags, persisted overrides, deterministic targeting and rollouts, request/InferDI evaluation, protected admin management, and evaluated client exposure.
- [0017 — Enterprise SSO](0017-enterprise-sso.md): Better Auth's SSO plugin behind a Nestrum provider registry, encrypted secrets, OIDC and SAML 2.0, domain mapping, protected admin management, and the rule that SSO never satisfies admin 2FA.
