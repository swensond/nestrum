# 0011 — Framework-owned Better Auth boundary

## Status

Accepted — Phase 10.

## Context

Better Auth is a foundational Nestrum dependency. Its current adapter contract is `createAdapterFactory`, while Nestrum's Prisma 8 collections expose provider-neutral QuerySet backends. Authentication records need protected framework contracts and a selected named database; application profile data should not be folded into the authentication user.

## Decision

`defineAuth` creates a framework-owned `nestrum.auth` app and contributes User, Session, Account, and Verification fragments inline to the selected database. `ApplicationConfig.auth` validates that database and those identities before startup. Auth models cannot be registered as ordinary resources. The app's adapter is supplied a binding of Prisma 8 collections and Mongo count callbacks, then translates Better Auth where clauses into QuerySpecs. Unsupported predicates and unscoped mutations fail closed. The adapter declares sequential transactions until client/transaction ownership is integrated.

The auth user exposes the Better Auth core fields. The user is not extensible: the auth contract is prebaked per provider (plus the `twoFactor` plugin's `twoFactorEnabled` and `TwoFactor` table) and verified against Better Auth's schema by a test. The earlier `AuthField` extension mechanism was removed. Core user/profile separation is the rule; application data is keyed by user id in application-owned models.

Better Auth owns the email/password and session endpoint semantics. Nestrum mounts GET/POST `/api/auth/*`, checks Origin against the configured base/trusted origins, and maps validated sessions through SubjectFactory. No identity is inferred from headers. Invalid, missing, or expired sessions become anonymous; an explicit runtime subject resolver takes precedence.

## Consequences

Auth works with the same named-database model and lifecycle as other framework-owned apps, while the application still supplies Prisma collection bindings and owns eventual clients. Public and admin layers can use the resulting request subject without coupling themselves to Better Auth types. Domain profiles and future admin access policies remain separate.

The MVP does not include social providers, MFA, email delivery, account linking, full plugin coverage, automatic client lifecycle, or live database proof. Better Auth upgrades must be checked against the adapter factory contract and schema changes.

## References

- [Phase 10](../phases/phase-10-auth.md)
- [Official Better Auth adapter guide](https://www.better-auth.com/docs/guides/create-a-db-adapter)
- [Official Better Auth email/password guide](https://www.better-auth.com/docs/authentication/email-password)
