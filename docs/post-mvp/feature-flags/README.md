# Nestrum Post-MVP Plan 05 — Feature Flags

## Status and navigation

This is the fifth planned post-MVP initiative. PM5.0 records the feature-flag contract; PM5.1–PM5.7 are Not Started. The registry, storage, targeting, runtime, admin, consumer exposure, and hardening described here are planned unless a phase records implementation evidence. Feature flags answer whether a capability is enabled; ABAC independently answers whether a subject is authorized.

| Phase | Goal | Primary surface | Status |
| --- | --- | --- | --- |
| [PM5.0 — Contract](phase-00-contract.md) | Document flags, precedence, storage, ABAC separation, and exposure | docs/core contracts | Complete |
| [PM5.1 — Registry](phase-01-registry.md) | Add typed registry and in-memory evaluator | core/runtime | Not Started |
| [PM5.2 — Storage](phase-02-storage.md) | Persist Nestrum-owned overrides | Prisma/config storage | Not Started |
| [PM5.3 — Targeting](phase-03-targeting.md) | Add targeting and deterministic rollouts | evaluator | Not Started |
| [PM5.4 — Runtime](phase-04-runtime.md) | Integrate evaluation with InferDI/request context | core/Hono/InferDI | Not Started |
| [PM5.5 — Admin](phase-05-admin.md) | Manage flags through protected admin | admin/admin-ui | Not Started |
| [PM5.6 — Client](phase-06-client.md) | Expose safe evaluated values to consumer UI | web/admin boundary | Not Started |
| [PM5.7 — Hardening](phase-07-hardening.md) | Add testing, overrides, diagnostics, invalidation, and audit seam | integration/security | Not Started |

## Contract

Applications define strongly typed boolean flags:

```ts
export const features = defineFeatureFlags({
  newDashboard: { default: false },
  projectArchiving: { default: false },
  experimentalSearch: { default: false },
});
```

Evaluation may be global or contextual:

```ts
await features.newDashboard.enabled();
await features.experimentalSearch.enabled({ subject, organizationId });
```

Every flag has a source default; absent persistent configuration falls back to it. Experimental flags normally default off. Initial values are boolean only; multivariate experiments are future work.

## Evaluation and authorization

Feature flags never bypass ABAC:

```text
feature enabled + ABAC authorized = capability available
```

Use a framework-owned context with optional subject, organization ID, environment, and attributes. Targeting initially supports global, environment, subject, organization, percentage rollout, and default. The final precedence must be explicit and tested; the planned order is subject → organization → percentage → environment → declared default.

Percentage rollout uses a deterministic hash of flag key and stable subject key. Do not use request-time `Math.random()`. Anonymous rollout requires an application-provided stable identifier; Nestrum does not create invasive tracking identifiers.

## Storage and runtime

Applications select a backing database, for example `features.database: "default"` or `"configuration"`; Nestrum owns the persistence models. InferDI supplies an injectable evaluator and request context (subject, organization, environment). Resource declarative feature gating is deferred; initial use is programmatic.

## Admin and consumer UI

Planned management routes are `/admin/features` and `/__admin/features/*`, protected by Better Auth, admin 2FA, `admin.access`, feature-management ABAC (`features.read`/`features.manage`), and same-origin policy. Management includes defaults, overrides, targeting, rollouts, and evaluation reasoning.

Only flags marked `exposeToClient: true` may reach the hosted consumer UI. The browser receives already-evaluated safe booleans, never targeting rules, rollout internals, hidden names, sensitive attributes, or server-only defaults. The server remains authoritative; the complete targeting engine is not duplicated in the browser.

## Development, testing, and audit

Future `nestrum dev --feature newDashboard=true` overrides are process-local and never mutate persistent storage. Testing helpers such as `withFeatureFlags({ newDashboard: true })` isolate overrides from shared state. Caching is optional and must invalidate deterministically. Feature changes expose an audit/event seam even if full audit history is separate.

Vitest covers defaults, every override level, precedence, deterministic rollouts, invalid names, anonymous context, exposure filtering, and test overrides. Playwright covers admin management and relevant consumer behavior.

## Definition of done

- [ ] Flags are strongly typed.
- [ ] Boolean defaults are source-defined.
- [ ] Overrides persist.
- [ ] Subject and organization targeting work.
- [ ] Percentage rollout is deterministic.
- [ ] Evaluation is available through InferDI.
- [ ] Admin manages flags securely with 2FA/ABAC.
- [ ] Consumer UI receives only explicitly exposed evaluated values.
- [ ] Feature flags never bypass ABAC.
- [ ] Tests override flags deterministically.
- [ ] Documentation reflects actual implementation.

Every phase updates documentation and leaves the repository green. See [architecture](../../architecture.md), [post-MVP roadmap](../../post-mvp.md), and [phase requirements](../../phases/README.md#completion-requirements).
