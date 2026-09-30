# Nestrum documentation

This documentation is the durable project memory for future implementation sessions. **Phases 0–15 are complete; Phase 16 integration is implemented and validated with real Docker SQL/Mongo databases.** Its MVP gate remains open for atomic object-policy writes. The phase records distinguish validated integration from that remaining requirement.

- [Architecture](architecture.md): locked framework contracts and actual implementation boundaries.
- [MVP](mvp.md): frozen scope and definition of done.
- [Post-MVP](post-mvp.md): explicitly deferred work.
- [Post-MVP Plan 01 — Self-serving runtime](post-mvp/runtime/README.md): planned `dev`/`build`/`serve` contracts and PM1.0–PM1.6 phase records.
- [Post-MVP Plan 02 — Admin 2FA enforcement](post-mvp/admin-2fa/README.md): default-required TOTP assurance for admin UI and API boundaries (implemented).
- [Post-MVP Plan 03 — First-class API keys](post-mvp/api-keys/README.md): implemented machine-to-machine authentication on Better Auth's API-key plugin, with scopes, ABAC, admin management, and rate limits ([decision 0015](decisions/0015-api-keys.md)).
- [Post-MVP Plan 04 — Hosted consumer application UI](post-mvp/consumer-ui/README.md): planned Svelte consumer hosting through the Nestrum lifecycle.
- [Post-MVP Plan 05 — Feature flags](post-mvp/feature-flags/README.md): planned typed capability evaluation with targeting, ABAC separation, and safe client exposure.
- [Phases](phases/README.md): bounded implementation tasks and validation records.
- [Decisions](decisions/README.md): rationale for decisions that need to survive future sessions.
- [Admin extensions](admin-extensions.md): custom action handlers, field overrides, and compiled widget registration.
- [Database workflow](database-workflow.md): commands, provider extensions, and lifecycle ownership.
- [Extension seams](extension-seams.md): contribution ownership, conflicts, and CLI/database extension boundaries.
- [Domain glossary](../CONTEXT.md): database definition, database name, default database, and model identity.

Begin each session by reading `architecture.md`, `mvp.md`, and the relevant phase document. Read `post-mvp.md` and relevant decisions when scope or tradeoffs matter.

A phase is complete only when implementation, tests, type checks, applicable builds, documentation, and deferred-work records are current. Describe actual behavior; do not retain planned behavior as if it shipped. Introduce packages only when their phase requires them.

One task should normally introduce one primary abstraction or integrate two existing abstractions. Split larger phases into sessions such as auth contracts/adapter, session routes, and subject mapping; each session must leave the repository green.
