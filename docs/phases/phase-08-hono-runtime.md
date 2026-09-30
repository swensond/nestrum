# Phase 8 — Hono and InferDI Runtime Integration

## Status

Complete

## Goal

Create the request-scoped HTTP runtime before authentication.

## Scope

- Fetch-based Hono bootstrap integrated with the existing application lifecycle.
- Real InferDI child scopes and concrete typed service graphs.
- Application/databases/resources/authorization and request/subject/environment values.
- Anonymous identity, trusted resolver hooks, and immutable request context.
- Consistent safe error responses, cleanup, and bounded request draining.

## Out of Scope

Better Auth, generated public/admin routes, OpenAPI, TCP listener/CLI/signal wiring, automatic Prisma client lifecycle, streaming/background scope ownership, request cancellation/timeouts, and formal non-Node runtime support.

## Architecture Decisions

See [ADR 0009](../decisions/0009-http-runtime-and-scope-ownership.md). The package depends on Hono 4.13.11 and @inferdi/inferdi/@inferdi/hono 6.1.0. Core imports no HTTP/DI dependencies. Hono uses a Web-standard Fetch boundary; this phase handles requests on Node without opening a network listener.

Use the official InferDI Hono adapter for per-request creation/setup/disposal rather than implementing a second disposal system. Framework-owned default roots dispose after application shutdown; supplied roots remain caller-owned. Directly inferred InferDI public return types reference inaccessible internal types, so exported graph/scope aliases use its public Spec/ScopeInputMap/WithRequirements helpers.

## Implementation

createHonoRuntime returns a HonoRuntime with hono, fetch, state, start, and shutdown. Configure custom routes before start. start awaits application.start; before readiness and after shutdown begins requests receive HTTP_RUNTIME_NOT_READY/503. Already started/stopped calls are idempotent; overlapping lifecycle transitions and restart attempts fail with HTTP_RUNTIME_STATE_INVALID. Startup errors preserve their original cause and clean up the default root.

Shutdown gates new requests and waits for bounded pipelines, including async reporting/disposal. Phase 15 adds stopTraffic before draining, explicit di.dispose opt-in for supplied roots, and managed database disconnect after reverse app/DI cleanup. Errors aggregate and all eligible cleanup continues. The host still owns sockets; stopTraffic integrates its listener shutdown. See [Phase 15](phase-15-cli-lifecycle.md).

createRuntimeContainer registers application, databases, resources, and authorization as externally owned values and declares request, subject, and environment scope inputs. Each ready request opens one real child scope through @inferdi/hono. Concrete service keys and readiness checks survive custom factory inference. Scope inputs become resolvable only after being supplied; framework values are not accidentally disposed by DI.

context.var.di (or context.get('di')) exposes the InferDI scope. context.var.nestrum is a frozen RequestContext with those framework values and request data. The default subject is { anonymous: true }; headers never imply identity. Trusted resolveSubject/resolveEnvironment hooks can asynchronously provide attribute records, and binding records/arrays/dates are copied. Request method/path are fixed to the actual request even if custom environment attributes use those names. Invalid resolver results fail before routing.

setupScope runs after child creation and before handlers. The official adapter disposes after setup failure, handler failure, or successful completion, and awaits async disposal. Owned services dispose in reverse creation order; externally supplied values and transient services remain caller-owned according to InferDI. Error observers receive request or scope-dispose phases. Disposal failures preserve a produced response; observer failures are logged and cannot replace it. Attribute/DI option maps are copied/frozen at the composition boundary; caller-owned opaque nested objects retain their lifetime responsibilities.

The detachable fetch handler forwards Request, optional host bindings, and optional Hono execution context. Hono.request provides socket-free tests. No Node imports or AsyncLocalStorage are used in source; request data travels through explicit Hono context and InferDI inputs.

## Public API

Exports: createHonoRuntime/HonoRuntime, createRuntimeContainer/openRequestScope, mapHttpError, RequestInputs/RequestContext/RequestScope/RuntimeContainer/RuntimeGraph, RuntimeEnv/RuntimeOptions/RuntimeState/RuntimeErrorEvent, and ErrorBody/MappedError.

Default graph:

```ts
import { createHonoRuntime } from '@nestrum/hono';

const runtime = createHonoRuntime({ application });
runtime.hono.get('/health', (context) => context.json({
    status: context.var.di.get('application').state
}));
await runtime.start();
const response = await runtime.fetch(new Request('http://localhost/health'));
// Bind runtime.fetch to your host; stop its listener before runtime shutdown.
await runtime.shutdown();
```

Typed service graph:

```ts
import type { AuthorizationEnvironment, Subject } from '@nestrum/core';
import { createHonoRuntime, createRuntimeContainer } from '@nestrum/hono';

class RequestInfo {
    constructor(readonly subject: Subject, readonly environment: AuthorizationEnvironment) {}
    describe() {
        return `${this.environment.method} ${this.subject.anonymous ? 'anonymous' : 'subject'}`;
    }
}
const root = createRuntimeContainer(application)
    .registerClass('requestInfo', RequestInfo, ['subject', 'environment'], 'scoped');
const runtime = createHonoRuntime({
    application,
    di: { container: root, createScope: (inputs) => root.createScope(inputs) }
});
runtime.hono.get('/info', (context) => context.text(context.var.di.get('requestInfo').describe()));
await runtime.start();
await runtime.shutdown();
await root.dispose();
```

application is a configured core application. Custom factories may be async and must return the scope they created; if a factory creates a scope and throws before returning it, that factory owns partial cleanup. setupScope is the supported hook for failures after creation. Custom graph roots must declare/provide the framework request inputs as illustrated. Standard InferDI factory/class/async registrations are supported; classes do not import DI internals.

resolveSubject(request, bindings) and resolveEnvironment(request, bindings) are trusted server hooks, not authenticators. Better Auth session-to-subject mapping remains Phase 10. Handlers can pass nestrum.subject/environment into existing authorization decisions and authorizedFor calls. Arbitrary manually registered Hono routes are not automatically authorized; generated resource pipelines arrive in Phase 9.

Error contract:

- AppError 4xx: original code/message and authorization reason when applicable.
- AppError 5xx: code with Internal server error; causes/stacks are excluded.
- ZodError: 400/VALIDATION_ERROR with issue code/path/message, never raw inputs.
- HTTPException: HTTP_ERROR with safe status/message and appropriate custom headers. JSON body replacement removes stale representation headers and preserves separate Set-Cookie values.
- Unexpected failures, including non-Error thrown values: 500/INTERNAL_SERVER_ERROR.
- Unknown route: 404/NOT_FOUND; unavailable runtime: 503/HTTP_RUNTIME_NOT_READY.

All use { error: { code, message, ... } }. mapHttpError is the pure mapping seam. onError(error, event) receives the full server-side error and optional RequestContext; default reporting uses console.error. Do not override the runtime's installed onError/middleware if you need its guarantees.

## Files / Packages Changed

- New packages/hono: package exports, portable TS/declaration build, runtime/container/context/error modules, and tests.
- pnpm lockfile plus generated exact Hono release-age exception in workspace config.
- Vitest adds @nestrum/hono as a fourth project; root glob checking already covers it.
- Architecture, README, phase/MVP/status indexes, glossary, and ADR 0009.
- No core/Prisma/Zod implementation changes.

## Tests

Coverage includes startup gating, anonymous/header behavior, actual InferDI tokens, concurrent isolation, typed graph readiness/key assertions, cached scoped services, reverse/async disposal, async service factories, existing ABAC context integration, success/error/setup cleanup, preserved responses on disposal failure, safe errors and headers/cookies, unknown routes, detached fetch, resolver snapshots/validation, immutable method/path, error observer failures, active-pipeline drain, resolver-error reporting drain, and lifecycle failure states.

## Acceptance Criteria

- [x] Hono handles Fetch requests after startup
- [x] Every ready request receives an isolated InferDI scope
- [x] Request scopes dispose on success/setup/handler failure
- [x] Errors map consistently
- [x] Core remains runtime-portable in design
- [x] Documentation reflects actual behavior

## Validation

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm check
pnpm build
```

pnpm check passed: 223 tests in eleven files, root type checking, and all four package builds. Frozen lockfile installation passed. Compiled ESM smoke checks verified scope inputs, anonymous identity, gating, cleanup, and caller root ownership. A separate TypeScript consumer verified compiled declarations, typed custom services, and missing-key/input errors. Markdown references and whitespace checks passed. Dependencies were checked against [Hono documentation](https://hono.dev/docs/api/hono), the [official InferDI Hono guide](https://inferdi.com/adapters/hono), [InferDI quick start](https://inferdi.com/guide/quick-start), and installed 6.1.0 declarations/source; Context7 has no relevant InferDI coverage.

## Known Limitations

No TCP listener, signal integration, generated resource APIs, OpenAPI, session authentication, or admin API exists yet. Database definitions are supplied values, not connected clients. Supplied roots, their singleton resources, static values, and transient instances remain caller-owned.

Disposal/draining covers bounded awaited routes, not streaming consumption, waitUntil work, or detached tasks. Scoped services must not outlive it; skipInferdiDispose does not transfer tracked ownership. Phase 15 adds optional drainTimeoutMs: timeout keeps traffic gated and resources open until requests finish/cancel and shutdown is retried. Host-owned abort controllers/socket cancellation remain explicit. Formal Bun/Deno/Cloudflare support remains post-MVP.

## Follow-Ups

Phase 9 integrates public CRUD/OpenAPI; QuerySet Read failures remain internal QUERY_RESULT_INVALID errors. Phase 10 adds session subjects. Phase 15 implements database CLI, pre-ready route barriers, host/signal/drain seams, and app/DI/database cleanup ordering. Phase 16 proves live integration. Atomic object-policy mutation remains an MVP follow-up; no post-MVP subsystem was implemented.

## Completion Notes

Phase 8 is complete. A portable Fetch-based Hono boundary now composes the existing application and ABAC services with real InferDI request scopes, awaited cleanup, and consistent errors. The repository passes required validation. Generated APIs/auth/admin and host listener integration remain in their planned phases.

Current integration evidence (2026-09-30): [Phase 16](phase-16-integration.md) now verifies real Docker PostgreSQL/Mongo contracts, migrations, resources, auth, admin forms/browser flows, and shutdown. Earlier phase-specific fixture results remain historical evidence. Atomic object-policy writes still deny and remain an unmet required MVP follow-up.
