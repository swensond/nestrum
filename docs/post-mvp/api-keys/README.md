# Nestrum Post-MVP Plan 03 — First-Class API Keys

## Status and navigation

This is the third planned post-MVP initiative. PM3.0 records the API-key contract; PM3.1–PM3.5 are Not Started. The key model, verifier, admin management, and resource authentication described here are planned unless a phase records implementation evidence. PM3 depends on the admin 2FA assurance boundary from [Post-MVP Plan 02](../admin-2fa/README.md) for key-management operations.

| Phase | Goal | Primary surface | Status |
| --- | --- | --- | --- |
| [PM3.0 — Contract](phase-00-contract.md) | Document key security, transport, ownership, scopes, and ABAC | docs/core contracts | Complete |
| [PM3.1 — Storage](phase-01-storage.md) | Generate and securely persist key metadata | auth/core storage | Not Started |
| [PM3.2 — Authentication](phase-02-authentication.md) | Authenticate requests and create API-key subjects | Hono/auth pipeline | Not Started |
| [PM3.3 — Scopes and ABAC](phase-03-scopes-abac.md) | Combine key scopes with resource authorization | resources/ABAC | Not Started |
| [PM3.4 — Admin management](phase-04-admin.md) | Manage keys through protected admin UI/API | admin/admin-ui | Not Started |
| [PM3.5 — Hardening](phase-05-hardening.md) | Add expiry, rate limits, rotation, redaction, and integration coverage | runtime/security | Not Started |

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

Nestrum may use Better Auth API-key primitives internally where useful, while preserving stable Nestrum semantics. API keys map to explicit subjects and do not impersonate users:

```ts
{
  type: "api-key",
  id: "key_123",
  owner: { type: "organization", id: "org_456" },
  attributes: { scopes: ["projects:read"] },
}
```

Initial owner types are `user` and `organization`; service identities remain future work.

## 3. Key model, format, and storage

Each key supports at least `id`, `name`, `prefix`, `hash`, `createdAt`, `expiresAt`, `lastUsedAt`, `revokedAt`, `ownerType`, `ownerId`, `scopes`, `metadata`, and rate-limit configuration.

Use a recognizable format such as `nes_live_...` and `nes_test_...`, or an equivalent documented format. Prefixes may support environment identification, safe display, and lookup optimization; secret material remains random and encodes no sensitive metadata. Persist only identifier/prefix, secure hash, and metadata. Return the complete plaintext exactly once and never store it.

## 4. Authentication and resource modes

Implementation chooses and documents one canonical transport, such as `Authorization: Bearer <api-key>` or `X-API-Key: <api-key>`. A recommended standard is required even if compatibility later accepts both.

Resources can declare accepted authentication modes. Initial modes are `session` and `api-key`; resource APIs remain opt-in.

The request pipeline is:

```text
request → extract key → verify hash → check expiration/revocation
        → check rate limit → build API-key subject → check scopes
        → resource ABAC → handler
```

Invalid, expired, and revoked credentials fail authentication immediately. No API-key request creates or refreshes a Better Auth browser session.

## 5. Ownership, scopes, expiry, revocation, and rotation

Support no expiration, explicit expiration, and a framework default TTL such as `apiKeys.defaultTtlDays`. Revocation sets `revokedAt` instead of deleting the record. Rotation is a first-class operation; the initial behavior may create and reveal a replacement once, then revoke the previous key. Grace-period overlap is future work unless needed.

Scopes include values such as `projects:read`, `projects:write`, and `events:write`. Scopes do not replace ABAC:

```text
API-key scope allows + ABAC allows = request allowed
```

Either denial denies the request. Policies may distinguish human sessions from API-key subjects.

## 6. Admin management

Framework-owned management is planned at `/admin/api-keys` with list, create, revoke, rotate, owner/scope/expiry/last-use inspection, and clear one-time reveal messaging. The secret is never shown after creation.

Private API operations are planned under `/__admin/api-keys/*`. They require Better Auth, admin 2FA from PM2, `admin.access`, API-key-management ABAC, and same-origin policy. Creation specifically requires `api-key.create` authorization in addition to the admin boundary.

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

Vitest and integration tests cover valid/invalid, expired/revoked, scope and ABAC denial, owner mapping, rate-limit boundaries, rotation, one-time reveal, plaintext non-persistence, and redaction. Admin integration verifies 2FA-protected create/list/revoke/rotate. When implemented, PM3 is complete when:

- [ ] API keys are framework-owned.
- [ ] Secrets are one-time reveal and hashed at rest.
- [ ] Keys expire and revoke.
- [ ] Resources opt into API-key auth.
- [ ] Keys map to explicit ABAC subjects.
- [ ] Scopes and ABAC both apply.
- [ ] Admin manages keys securely.
- [ ] Admin 2FA protects management.
- [ ] Rate limiting has a supported framework path.
- [ ] Applications need no custom API-key middleware.

Every phase updates documentation and leaves the repository green. See [architecture](../../architecture.md), [post-MVP roadmap](../../post-mvp.md), and [phase documentation requirements](../../phases/README.md#completion-requirements).
