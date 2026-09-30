# Nestrum Post-MVP Plan 03 — First-Class API Keys

## Status and navigation

This is the third post-MVP initiative and is implemented (PM3.0–PM3.5 are complete) on Better Auth's official `@better-auth/api-key` plugin; see [decision 0015](../../decisions/0015-api-keys.md) for the choices that refine the original plan. Key management depends on the admin 2FA assurance boundary from [Post-MVP Plan 02](../admin-2fa/README.md). Two plan items are narrowed: only `user` owners exist (organization owners need Better Auth's organization plugin), and the Docker + MongoDB integration section could not run in the authoring environment.

| Phase | Goal | Primary surface | Status |
| --- | --- | --- | --- |
| [PM3.0 — Contract](phase-00-contract.md) | Document key security, transport, ownership, scopes, and ABAC | docs/core contracts | Complete |
| [PM3.1 — Storage](phase-01-storage.md) | Generate and securely persist key metadata | auth/core storage | Complete |
| [PM3.2 — Authentication](phase-02-authentication.md) | Authenticate requests and create API-key subjects | Hono/auth pipeline | Complete |
| [PM3.3 — Scopes and ABAC](phase-03-scopes-abac.md) | Combine key scopes with resource authorization | resources/ABAC | Complete |
| [PM3.4 — Admin management](phase-04-admin.md) | Manage keys through protected admin UI/API | admin/admin-ui | Complete |
| [PM3.5 — Hardening](phase-05-hardening.md) | Add expiry, rate limits, rotation, redaction, and integration coverage | runtime/security | Complete |

## 1. Goal and security rules

Applications should be able to opt resource APIs into API-key authentication without implementing key storage, hashing, verification, expiration, revocation, scope checks, or middleware:

```ts
defineResource({
  model: "Project",
  api: {
    auth: ["session", "api-key"],
    list: true,
    retrieve: true,
  },
});
```

API keys are cryptographically random, shown once, hashed at rest, expirable, revocable, owner-bound, scope-bearing, ABAC-aware, and able to carry rate-limit metadata. They never become browser sessions; Nestrum never exchanges a key for an ordinary Better Auth session.

## 2. Better Auth relationship and subjects

Better Auth remains foundational for human sessions. The Nestrum API-key contract is:

```text
API key credential
      ↓
Nestrum API-key verifier
      ↓
API-key principal
      ↓
SubjectFactory
      ↓
ABAC Subject
```

Nestrum uses the Better Auth API-key plugin for generation, hashing, verification, expiry, and rate limiting, and adds only stable Nestrum semantics around it. API keys map to explicit subjects and do not impersonate users:

```ts
{
  type: "api-key",
  id: "key_123",
  owner: { type: "organization", id: "org_456" },
  attributes: { scopes: ["projects:read"] },
}
```

Shipped owner type is `user`; `organization` owners (which need Better Auth's organization plugin) and service identities remain future work. Actual subject shape: `{ id, anonymous: false, type: 'api-key', owner: { type: 'user', id }, scopes }`.

## 3. Key model, format, and storage

Each key supports at least `id`, `name`, `prefix`, `hash`, `createdAt`, `expiresAt`, `lastUsedAt`, `revokedAt`, `ownerType`, `ownerId`, `scopes`, `metadata`, and rate-limit configuration.

The format is `nes_live_` (configurable, e.g. `nes_test_`) followed by 64 random letters. Prefixes may support environment identification, safe display, and lookup optimization; secret material remains random and encodes no sensitive metadata. Persist only identifier/prefix, secure hash, and metadata. Return the complete plaintext exactly once and never store it.

## 4. Authentication and resource modes

The canonical transport is `X-API-Key: <api-key>`, Better Auth's own header, read only for public resource API requests.

Resources can declare accepted authentication modes. Initial modes are `session` and `api-key`; resource APIs remain opt-in.

The request pipeline is:

```text
request → extract key → verify hash → check expiration/revocation
        → check rate limit → build API-key subject → check scopes
        → resource ABAC → handler
```

Invalid, expired, and revoked credentials fail authentication immediately. No API-key request creates or refreshes a Better Auth browser session.

## 5. Ownership, scopes, expiry, revocation, and rotation

Support no expiration, explicit expiration, and a framework default TTL such as `apiKeys.defaultTtlDays`. Revocation disables the key and records `revokedAt` in its metadata instead of deleting the record (the plugin deletes expired keys when next verified). Rotation is a first-class operation; the initial behavior may create and reveal a replacement once, then revoke the previous key. Grace-period overlap is future work unless needed.

Scopes include values such as `projects:read`, `projects:write`, and `events:write`. Scopes do not replace ABAC:

```text
API-key scope allows + ABAC allows = request allowed
```

Either denial denies the request. Policies may distinguish human sessions from API-key subjects.

## 6. Admin management

Framework-owned management is at `/admin/api-keys` with list, create, revoke, rotate, owner/scope/expiry/last-use inspection, and clear one-time reveal messaging. The secret is never shown after creation.

Private API operations are under `/__admin/api-keys/*`. They require Better Auth, admin 2FA from PM2, `admin.access`, the `api-key` ABAC actions (`read`, `create`, `revoke`, `rotate`), and same-origin policy. Creation specifically requires the `api-key`/`create` action in addition to the admin boundary.

## 7. Rate limits and secret safety

Keys carry framework rate-limit metadata, for example:

```ts
apiKeys: {
  rateLimit: {
    enabled: true,
    requests: 1000,
    windowSeconds: 60,
  },
}
```

The first provider may be simple; the abstraction must allow Redis/external providers later. Track `lastUsedAt` without logging credentials. Never log a complete key or echo a supplied credential in errors; use safe forms such as `key_123` or `nes_live_abcd...wxyz`.

## 8. Testing and definition of done

Vitest and integration tests cover valid/invalid, expired/revoked, scope and ABAC denial, owner mapping, rate-limit boundaries, rotation, one-time reveal, plaintext non-persistence, and redaction. Admin integration verifies 2FA-protected create/list/revoke/rotate. PM3 is complete:

- [x] API keys are framework-owned.
- [x] Secrets are one-time reveal and hashed at rest.
- [x] Keys expire and revoke.
- [x] Resources opt into API-key auth.
- [x] Keys map to explicit ABAC subjects.
- [x] Scopes and ABAC both apply.
- [x] Admin manages keys securely.
- [x] Admin 2FA protects management.
- [x] Rate limiting has a supported framework path.
- [x] Applications need no custom API-key middleware.

Every phase updates documentation and leaves the repository green. See [architecture](../../architecture.md), [post-MVP roadmap](../../post-mvp.md), and [phase documentation requirements](../../phases/README.md#completion-requirements).
