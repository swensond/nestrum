# Architecture decisions

Use ADR-style records when future sessions need the reasoning for a durable decision. Routine implementation details belong in phase records. Each record should identify status, context, decision, consequences, and relevant references. User-approved locked architecture is summarized in [architecture](../architecture.md).

- [0001 — Workspace tooling](0001-workspace-tooling.md): TypeScript 7, ESM compilation, and current Vitest projects with the requested workspace filename.
- [0002 — Application lifecycle](0002-application-lifecycle.md): immutable app graphs, configure/ready barriers, lifecycle states, and failure cleanup.
- [0003 — Database registration boundary](0003-database-registration-boundary.md): Prisma-specific metadata in core, one-way package dependencies, and configuration-only named registration.
- [0004 — Prisma contract assembly](0004-prisma-contract-assembly.md): app fragment ownership, native validation, release-candidate compatibility, and generated artifact boundaries.

- [0005 — Metadata and runtime schema representations](0005-metadata-and-runtime-schemas.md): actual codec representations, canonical metadata, runtime generation, and explicit compatibility authoring.

- [0006 — Resource bootstrap and package boundaries](0006-resource-bootstrap-boundary.md): shared metadata ownership, cycle-free schema composition, and pre-hook resource validation.
