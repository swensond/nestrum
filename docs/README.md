# Nestrum documentation

This documentation is the durable project memory for future implementation sessions. **Phases 0–14 are complete; Phases 15–16 are not started.** Phase 14's implementation and validation are recorded in its phase document. APIs in later phase records remain design targets.

- [Architecture](architecture.md): locked framework contracts and actual implementation boundaries.
- [MVP](mvp.md): frozen scope and definition of done.
- [Post-MVP](post-mvp.md): explicitly deferred work.
- [Phases](phases/README.md): bounded implementation tasks and validation records.
- [Decisions](decisions/README.md): rationale for decisions that need to survive future sessions.
- [Admin extensions](admin-extensions.md): custom action handlers, field overrides, and compiled widget registration.
- [Extension seams](extension-seams.md): contribution ownership, conflicts, and planned CLI/database boundaries.
- [Domain glossary](../CONTEXT.md): database definition, database name, default database, and model identity.

Begin each session by reading `architecture.md`, `mvp.md`, and the relevant phase document. Read `post-mvp.md` and relevant decisions when scope or tradeoffs matter.

A phase is complete only when implementation, tests, type checks, applicable builds, documentation, and deferred-work records are current. Describe actual behavior; do not retain planned behavior as if it shipped. Introduce packages only when their phase requires them.

One task should normally introduce one primary abstraction or integrate two existing abstractions. Split larger phases into sessions such as auth contracts/adapter, session routes, and subject mapping; each session must leave the repository green.
