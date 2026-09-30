# PM1.1 — Runtime Adapter Abstraction

## Status

Not Started

## Goal

Create a minimal runtime-neutral server adapter contract in `@nestrum/runtime`.

## Scope

- Introduce `packages/runtime` and wire its exports, build, type checking, and Vitest project.
- Define `RuntimeAdapter`, `ServerHandle`, and `ServeOptions` using web-standard types.
- Resolve the adapter's ready application/Fetch input against existing core and Hono contracts.
- Define startup failure, close ownership, and lifecycle semantics sufficient for a fake adapter and the following Node phase.

## Out of Scope

Node APIs, Node listener implementation, CLI serving, watchers, build pipeline, and speculative context/capability/environment abstractions.

## Architecture Decisions

Depends on [PM1.0](phase-00-runtime-contract.md). Keep runtime-neutral contracts free of Node imports and ambient Node API requirements. The CLI orchestrates an adapter; the adapter does not discover applications or generate artifacts. Preserve core application lifecycle and Hono request/DI ownership.

## Implementation

Planned. Start from the illustrative contract:

```ts
interface RuntimeAdapter {
  serve(
    application: NestrumApplication,
    options: ServeOptions,
  ): Promise<ServerHandle>;
}

interface ServerHandle {
  close(): Promise<void>;
}

interface ServeOptions {
  host: string;
  port: number;
}
```

Finalize the concrete application type, close semantics, and any necessary split between stopping traffic and final closure before publishing the interface. Add abstractions only when an immediate consumer needs them.

## Public API

Planned `@nestrum/runtime` exports for adapter/options/handle contracts. Exact exports and lifecycle guarantees must be documented after implementation.

## Files / Packages Changed

Planned: `packages/runtime`, workspace build/test/typecheck wiring, [architecture](../../architecture.md), [initiative index](README.md), and this phase record.

## Tests

Use a fake adapter in Vitest to prove application input, server startup, and close semantics. Verify the portable build needs no Node APIs/types.

## Acceptance Criteria

- [ ] Runtime package contains no Node APIs.
- [ ] Fake runtime adapter runs in Vitest.
- [ ] Server lifecycle contract is testable.
- [ ] Documentation describes the implemented contract.

## Validation

Run targeted adapter tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, and `pnpm check`; check whitespace and portable exports. Record actual results before marking Complete.

## Known Limitations

Contracts alone do not open an HTTP listener or provide runtime CLI commands. Bun, Deno, and Cloudflare support remain deferred.

## Follow-Ups

[PM1.2](phase-02-node-runtime.md) implements Node serving against these contracts.

## Completion Notes

Pending implementation and validation.
