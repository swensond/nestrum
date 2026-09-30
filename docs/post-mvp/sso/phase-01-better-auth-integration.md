# PM6.1 — Better Auth SSO Plugin Integration

## Status

Not Started

## Goal

Install `@better-auth/sso` and register it in Nestrum's framework-owned Better Auth subsystem.

## Scope

- Add the plugin dependency and register it in `createAuthInstance` when `auth.sso.enabled` is true.
- Include the SSO provider schema in the framework-owned prebaked auth contract (PostgreSQL and MongoDB) and protected auth models.
- Make the plugin's callback routes reachable through the allowlisted `/api/auth` forwarding, and add any SSO client integration required.
- Keep existing email/password, session, 2FA, admin, and API-key behavior unchanged.

## Out of Scope

Nestrum management API/UI, provider registry, provisioning policy, and domain verification UX.

## Architecture Decisions

Depends on [PM6.0](phase-00-contract.md). The contract test compares the prebaked models with Better Auth's own schema for the configured plugins so upgrades cannot drift. SSO is off unless enabled, and the existing endpoint allowlist stays deny-by-default: only the SSO sign-in and callback paths needed for OIDC and SAML are added. Callback origins remain restricted to trusted origins.

## Implementation

Planned plugin registration, contract additions, migration guidance for existing applications, and the callback route allowlist.

## Public API

Planned `auth.sso.enabled` configuration and the additional protected auth model(s).

## Files / Packages Changed

Planned `packages/auth`, contracts, auth tests, architecture, initiative index, and this record.

## Tests

Cover plugin startup, contract-vs-plugin schema parity for both providers, callback route reachability, deny-by-default for other plugin routes, and unchanged existing authentication.

## Acceptance Criteria

- [ ] Plugin starts with Nestrum auth.
- [ ] Framework owns the required auth schema.
- [ ] Callback routes work.
- [ ] Existing authentication remains functional.
- [ ] Docs updated.

## Validation

Run auth tests, `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm check`, real Prisma contract emission for both providers, and `git diff --check`.

## Known Limitations

No provider management, discovery UX, or provisioning policy yet.

## Follow-Ups

[PM6.2](phase-02-provider-registry.md) adds the provider registry and secure persistence.

## Completion Notes

Pending implementation and validation.
