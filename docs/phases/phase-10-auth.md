# Phase 10 — Framework-Owned Better Auth

## Status

Not Started

## Goal

Make Better Auth a built-in subsystem with owned Prisma 8 contracts and adapter.

## Scope

- Contribute protected User, Session, Account, and Verification fragments.
- Implement a Nestrum-owned Better Auth Prisma 8 adapter.
- Select auth storage through auth.database.
- Permit sanctioned user extension fields while protecting minimal core auth models.
- Provide register, login, logout, session retrieval, and SubjectFactory session-to-ABAC mapping.

## Out of Scope

Replaceable auth providers, application profile data in core auth user, and admin.

## Architecture Decisions

Keep domain/profile data separate from the authentication-oriented user. This phase may be split into contracts/adapter, session routes, and SubjectFactory sessions, each leaving the repository green.

## Implementation

Not implemented. The scope and public API below are planned targets, not available behavior.

## Public API

Planned: auth: { database: 'identity', extend: { user: { timezone: field.string().optional() } } }; SubjectFactory.

## Files / Packages Changed

None yet. Planned scope: @nestrum/auth. Introduce only packages needed by this phase.

## Tests

Adapter operations, selected database isolation, protected contract conflicts, extension validation, register/login/logout/session flows, and subject mapping.

## Acceptance Criteria

- [ ] Auth works on the selected named database
- [ ] Owned Prisma 8 adapter works
- [ ] Owned auth models are protected
- [ ] Sanctioned user extension works
- [ ] Session maps to ABAC subject
- [ ] Documentation is updated

## Validation

```bash
pnpm test
pnpm typecheck
pnpm check
pnpm build
```

Not run: phase not started.

## Known Limitations

All capabilities in this phase remain unimplemented. Verify dependency versions and provider/runtime constraints before implementation.

## Follow-Ups

Complete this bounded phase before proceeding to the next. Capture newly deferred features in [post-MVP](../post-mvp.md).

## Completion Notes

No completion claims. Update this record with actual implementation, test evidence, deviations, and limitations when work begins.
