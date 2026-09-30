# PM1.1 — Runtime Adapter Abstraction

## Status

Complete

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

Added `packages/runtime` (`@nestrum/runtime`, private, no dependencies) with types only, wired into the workspace Vitest project list, the root type check, and `pnpm -r build`.

```ts
interface ServableApplication {
  readonly fetch: (request: Request) => Response | Promise<Response>;
}

interface ServeOptions {
  readonly host: string;
  readonly port: number; // 0 = ephemeral; the bound port is reported on the handle
}

interface ServerHandle {
  readonly host: string;
  readonly port: number;
  stopAccepting(): Promise<void>;
  close(): Promise<void>;
}

interface RuntimeAdapter {
  serve(application: ServableApplication, options: ServeOptions): Promise<ServerHandle>;
}
```

Decisions:

- **Application input.** `ServableApplication` requires only a web-standard Fetch handler, so `@nestrum/runtime` depends on neither core nor Hono. `HonoRuntime` satisfies it structurally (its `fetch` accepts optional bindings/execution context). The caller starts the application and completes readiness before `serve`; adapters never start, configure, or shut down the application.
- **Stopping traffic versus closing.** `stopAccepting()` is separate from `close()` so hosts can gate traffic before draining requests and shutting the application down, matching the existing `stopTraffic` hook of `createHonoRuntime`. Both are idempotent and safe to call concurrently; `close()` implies `stopAccepting()`.
- **Startup failure.** `serve` resolves only once the server accepts traffic. On failure it rejects and leaves no listener or other resource behind.
- **Closing a handle** does not shut down the application; ordered shutdown belongs to the orchestrator (PM1.6).
- No `RuntimeContext`, `RuntimeCapabilities`, or `RuntimeEnvironment` abstractions were added.

## Public API

`@nestrum/runtime` exports the types `RuntimeAdapter`, `ServableApplication`, `ServeOptions`, and `ServerHandle`. There are no runtime values.

## Files / Packages Changed

`packages/runtime` (new), `vitest.workspace.ts`, `pnpm-lock.yaml`, [architecture](../../architecture.md), [initiative index](README.md), the [roadmap](../../post-mvp.md), and this phase record.

## Tests

Use a fake adapter in Vitest to prove application input, server startup, and close semantics. Verify the portable build needs no Node APIs/types.

## Acceptance Criteria

- [x] Runtime package contains no Node APIs.
- [x] Fake runtime adapter runs in Vitest.
- [x] Server lifecycle contract is testable.
- [x] Documentation describes the implemented contract.

## Validation

Validated: `vitest run --project @nestrum/runtime` (5 tests pass), `tsc --noEmit -p tsconfig.json` (clean), `pnpm --filter @nestrum/runtime build` (clean, compiled with `types: []`, so no Node types are available), and `biome check` on the new files. The full `vitest run` passes all 343 tests; the three `@nestrum/admin-ui` test files fail to transform in this environment both with and without this change (pre-existing). `pnpm-lock.yaml` was updated by hand (`packages/runtime: {}`) and `pnpm install --frozen-lockfile` accepts it.

## Known Limitations

Contracts alone do not open an HTTP listener or provide runtime CLI commands. Bun, Deno, and Cloudflare support remain deferred.

## Follow-Ups

[PM1.2](phase-02-node-runtime.md) implements Node serving against these contracts.

## Completion Notes

PM1.1 ships contracts only. No HTTP listener, CLI command, or Node code exists yet; [PM1.2](phase-02-node-runtime.md) is next.
