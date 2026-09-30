# 0014 — Roles and staff management

## Status

Accepted — follows the admin 2FA initiative ([Plan 02](../post-mvp/admin-2fa/README.md)).

## Context

Admin access was decided by an application-supplied `admin.access` policy, and the example hard-coded which user ids counted as staff. Operators needed a way to create the first administrator without a signup path that grants privilege, and administrators needed to decide who else may use administration without editing configuration or the database.

## Decision

- **Roles** come from Better Auth's `admin` plugin: `user` (default), `staff`, and `admin`. Only `admin` holds user-management permission in Better Auth's access control (`list`, `get`, `create`, `set-role`); ban, impersonation, session, deletion, and password permissions are granted to no role. The default subject carries the role (`subject.role`).
- **Administrators are created only with the CLI** (`nestrum auth create-admin`), against a previous build, with the password from `NESTRUM_ADMIN_PASSWORD` or a hidden prompt (never an argument). `--promote` upgrades an existing account. The account is created through Better Auth's internal adapter (email marked verified, credential account linked); no HTTP path can create or promote an administrator. Public sign-up rejects a `role` field.
- **Staff are managed in the admin interface** at `/admin/access`, backed by `GET /__admin/access/{capabilities,users}` and `POST /__admin/access/users/:id/role`. The routes sit behind the full admin boundary (same origin, session, `admin.access`, two-factor assurance), then require the `admin.users`/`manage` ABAC action, and Better Auth re-checks the caller's role. Only `user` and `staff` can be assigned, and administrators are never modified through the interface (validated at runtime, not only by types).
- **Standard policies**: `roleBasedAdminPolicies()` (`@nestrum/admin`) allows `staff` and `admin` into administration and only `admin` to manage users. Applications include it in `policies` or supply their own `admin.access`/`admin.users` policies; a missing `admin.users` policy denies.
- **Better Auth admin endpoints are not exposed over HTTP.** Nestrum's `/api/auth` allowlist does not forward `/admin/*`; the plugin is used only through server-side calls made by the admin routes and the CLI.

## Consequences

- No hard-coded ids or example-specific staff flags: elevation is a reversible action by an administrator. Changing a user's role updates the user record, so that user's existing sessions must sign in again before they satisfy the admin assurance rule (see the admin 2FA record), which also means a demoted user's older sessions stop working for admin immediately.
- The user list supports paging and an exact-email filter. Substring search is not offered because the Prisma-backed query layer does not yet compile `contains`/`startsWith` filters for both providers.
- `nestrum auth create-admin` starts the whole application (all databases must be reachable) because that is how Better Auth is initialized; it binds no listener and shuts down afterward.
- Existing applications must migrate the new `User` columns (`role`, `banned`, `banReason`, `banExpires`) and `Session.impersonatedBy`, then create an administrator; existing users keep a null role, which is treated as `user`.
- There is no audit trail of role changes yet.

## References

- [Better Auth admin plugin](https://www.better-auth.com/docs/plugins/admin)
- [0011 — Framework-owned Better Auth boundary](0011-better-auth-boundary.md)
