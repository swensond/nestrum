# Nestrum documentation

This documentation is the durable project memory for future implementation sessions. **Phases 0–15 are complete; Phase 16 integration is implemented and validated with real Docker SQL/Mongo databases.** Its MVP gate remains open for atomic object-policy writes. The phase records distinguish validated integration from that remaining requirement.

- [Architecture](architecture.md): locked framework contracts and actual implementation boundaries.
- [MVP](mvp.md): frozen scope and definition of done.
- [Post-MVP](post-mvp.md): explicitly deferred work.
- [Phases](phases/README.md): bounded implementation tasks and validation records.
- [Decisions](decisions/README.md): rationale for decisions that need to survive future sessions.
- [Admin extensions](admin-extensions.md): custom action handlers, field overrides, and compiled widget registration.
- [Database workflow](database-workflow.md): commands, provider extensions, and lifecycle ownership.
- [Extension seams](extension-seams.md): contribution ownership, conflicts, and CLI/database extension boundaries.
- [Domain glossary](../CONTEXT.md): database definition, database name, default database, and model identity.

Begin each session by reading `architecture.md`, `mvp.md`, and the relevant phase document. Read `post-mvp.md` and relevant decisions when scope or tradeoffs matter.

A phase is complete only when implementation, tests, type checks, applicable builds, documentation, and deferred-work records are current. Describe actual behavior; do not retain planned behavior as if it shipped. Introduce packages only when their phase requires them.

One task should normally introduce one primary abstraction or integrate two existing abstractions. Split larger phases into sessions such as auth contracts/adapter, session routes, and subject mapping; each session must leave the repository green.
