# Phase 10 — Framework-Owned Better Auth

## Status

Complete

## Goal

Make Better Auth a built-in subsystem with owned Prisma 8 contracts and adapter.

## Scope

- Contribute protected User, Session, Account, and Verification fragments.
- Implement a Nestrum-owned Better Auth Prisma 8 adapter over Prisma 8 QueryBackend collections.
- Select auth storage through auth.database.
- Permit sanctioned user extension fields while protecting minimal core auth models.
- Provide register, login, logout, session retrieval, and SubjectFactory session-to-ABAC mapping.

## Out of Scope

Replaceable auth providers, application profile data in core auth user, and admin.

## Architecture Decisions

Keep domain/profile data separate from the authentication-oriented user. Better Auth remains a framework-owned subsystem and is configured through defineAuth. The auth app contributes inline per-database Prisma contracts, while application-owned contract files remain app-owned. Auth records are accessed only through the owned adapter and cannot be registered as ordinary resources.

Better Auth 1.7.6's createAdapterFactory contract is the integration boundary. The adapter advertises dates/booleans but no JSON/arrays/numeric IDs, maps Better Auth where operators into provider-neutral QuerySpecs, projects explicit selections, bounds pagination, and rejects unscoped mutations. Prisma 8 transactions are not assumed; the adapter declares sequential operation semantics. Auth IDs are generated as strings.

The framework selects one named database and checks the binding identity at bootstrap. Its protected model identities are <database>.User, Session, Account, Verification, and (since the admin 2FA, roles, and API-key work) TwoFactor and ApiKey. User also carries the admin plugin's role and ban fields; see [decision 0014](../decisions/0014-roles-and-staff-management.md). Domain profile fields do not get added to User. **Update:** the original `extend.user`/`AuthField` mechanism was removed so the auth contract could be prebaked per provider; application-specific user data belongs in application-owned models keyed by user id.

Session subject resolution is trusted runtime input: absent/expired/invalid sessions become { anonymous: true }, valid sessions map to { id, anonymous: false } by default, and a SubjectMapper can add domain attributes. Header identity is never inferred. Auth endpoints are mounted under /api/auth and reject foreign Origin headers; the selected base origin is allowed by default.

## Implementation

@nestrum/auth now exports defineAuth, field, SubjectFactory, createPrismaAuthAdapter, authContract, and the auth types. ApplicationConfig accepts auth: AuthenticationDefinition; application.auth is initialized between model registration and app hooks. @nestrum/hono uses application.auth.resolveSubject unless a runtime resolveSubject override is provided, then mounts Better Auth GET/POST routes under /api/auth.

## Public API

```ts
import { defineAuth, field } from '@nestrum/auth';
import { createHonoRuntime } from '@nestrum/hono';

const auth = defineAuth({
    database: 'identity',
    baseURL: 'https://app.example.com',
    secret: process.env.BETTER_AUTH_SECRET!,
    prisma: ({ database }) => configuredPrismaAuthCollections(database),
    subjectFactory: ({ user }) => ({ id: user.id, emailVerified: user.emailVerified })
});

const runtime = createHonoRuntime({ application: defineApplication({ databases, apps, auth }) });
```

Better Auth's standard email/password endpoints are available below `/api/auth`: sign-up/email, sign-in/email, sign-out, and get-session. The framework validates and delegates the endpoint semantics to Better Auth. A trusted `prisma` factory supplies the four Prisma 8 collections and, for MongoDB, per-model count callbacks. No direct Prisma CLI or client ownership is introduced in this phase.

## Files / Packages Changed

- @nestrum/auth: prebaked contracts, Better Auth 1.7.6 adapter, defineAuth, SubjectFactory, and tests.
- @nestrum/core: auth configuration/definition, protected application registration, app auth initialization, and exported session types.
- @nestrum/prisma: inline Prisma source assembly for framework-owned fragments.
- @nestrum/hono: application session subject fallback and /api/auth route mounting.
- workspace package/lockfile and Vitest workspace.
- Architecture, MVP, README, and this phase documentation.

## Tests

Adapter operations, provider contract generation, selected database isolation, protected contract conflicts, extension validation, selection/pagination and unscoped mutation guards, register/login/logout/session flows, origin/cookie handling, expired sessions, forged identity rejection, and SubjectFactory mapping.

## Acceptance Criteria

- [x] Auth works on the selected named database
- [x] Owned Prisma 8 adapter works
- [x] Owned auth models are protected
- [x] Sanctioned user extension works
- [x] Session maps to ABAC subject
- [x] Documentation is updated

## Validation

```bash
pnpm test
pnpm typecheck
pnpm check
pnpm build
```

Validated on 2026-09-29:

- `pnpm install`: passed with Better Auth 1.7.6 and the updated workspace lockfile.
- `pnpm check`: passed, executing 270 tests in 13 files, strict typecheck, and all five package builds.
- Auth integration tests passed registration/password hashing, named database selection, protected contracts, extensions, origin checks, cookies, login/logout, session retrieval, expired/forged sessions, adapter selection/paging/count/mutations, and SubjectFactory mapping.
- Compiled ESM and TypeScript consumer checks passed for auth exports, core Authentication types, and Hono session resolution.
- Documentation QA and `git diff --check` passed.

## Known Limitations

This phase uses Better Auth's email/password and session APIs but does not add social providers, plugins, email verification delivery, MFA, or admin. The adapter intentionally declares sequential transaction behavior because application-owned Prisma 8 collections do not yet expose a framework transaction lifecycle. Atomic consume/increment adapter methods are not required for the MVP auth flows.

Auth contract emission is inline and provider-aware, but contract generation still follows the existing explicit application-owned workflow. Auth does not create or close database clients. Mongo live integration and SQL live integration remain Phase 16. Domain profile storage is intentionally separate.

## Follow-Ups

Phase 11 can consume application.auth and SubjectFactory for admin access. Phase 15 can move auth route registration into the final lifecycle barrier and add client/disconnect ownership. Phase 16 should run live selected-database SQL and Mongo auth flows. Social auth, verification delivery, MFA, account linking, and richer auth plugins remain deferred.

## Completion Notes

Phase 10 is complete. Framework-owned Better Auth contracts, adapter, sessions, and subject mapping compose with the selected named database, application lifecycle, Hono request context, and ABAC. Required validation and compiled consumers pass. Client ownership, live database proof, richer providers/plugins, and admin integration remain explicitly scoped to later phases.

Current integration evidence (2026-09-30): [Phase 16](phase-16-integration.md) now verifies real Docker PostgreSQL/Mongo contracts, migrations, resources, auth, admin forms/browser flows, and shutdown. Earlier phase-specific fixture results remain historical evidence. Atomic object-policy writes still deny and remain an unmet required MVP follow-up.
