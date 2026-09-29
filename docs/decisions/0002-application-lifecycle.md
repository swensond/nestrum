# 0002 — Application lifecycle

## Status

Accepted for Phase 1.

## Context

Apps need deterministic dependency ordering, asynchronous hooks, and reverse shutdown. Later subsystems will join bootstrap; Phase 1 must establish app semantics without introducing databases, DI, or HTTP. Startup may fail after an app has partially acquired resources.

## Decision

App registration is explicit and immutable. defineApp() and AppRegistry snapshot definitions/dependency arrays without freezing caller-owned values. Validate names, duplicates, missing dependencies, and cycles before hooks. Use depth-first topological traversal in registration order and declared dependency order; visit shared dependencies once. Return frozen ordered definitions.

defineApplication() constructs an application eagerly without starting it. start() and shutdown() are awaited operations. Run all configure hooks before any ready hook, leaving a clear future integration boundary between these phases. Hooks receive { application, apps } and may be synchronous or asynchronous.

States are created, starting, ready, stopping, stopped, and failed. Starting an already ready application or shutting down a stopped one is a no-op. Reject overlapping operations and restart of a stopped/failed instance. Callers await completion and create a fresh instance to restart.

If startup fails, attempt shutdown of every app whose configuration was entered, including the failing app, in reverse order. After a ready failure, all configured apps are eligible. Continue cleanup even if hooks fail. Preserve the original hook cause and aggregate startup/cleanup errors when both fail. Normal shutdown also attempts every eligible hook and aggregates errors. Each shutdown hook is attempted at most once; failures do not trigger automatic retries.

## Consequences

Graph errors cannot cause partially executed startup hooks. Readiness cannot be reported while an async hook is pending. Apps must make shutdown safe after partial configure and must own their resource cleanup. A shutdown error reports unsuccessful cleanup even though the lifecycle becomes stopped; a failed start becomes failed after cleanup attempts.

This phase does not stop network traffic, dispose InferDI, or disconnect framework-managed databases. Their ordering and failure behavior will be integrated in subsequent phases and hardened in Phase 15. Live app registration, startup cancellation, and in-place restart are not provided.

## References

- [Architecture](../architecture.md)
- [Phase 1](../phases/phase-01-application.md)
