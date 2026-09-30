import type { AuthRole } from '@nestrum/core';
import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements } from 'better-auth/plugins/admin/access';

export const AUTH_ROLES: readonly AuthRole[] = Object.freeze(['user', 'staff', 'admin']);
/** Roles an administrator may assign in the admin UI. Administrators themselves are created with the CLI. */
export const ASSIGNABLE_ROLES = Object.freeze(['user', 'staff'] as const);

const ac = createAccessControl(defaultStatements);

/**
 * Better Auth access control for the admin plugin. Only `admin` may list, read, create, or re-role users; `staff` and
 * `user` hold no user-management permission. Ban, impersonation, session, deletion, and password permissions are not
 * granted to any role, and the corresponding endpoints are not forwarded over HTTP.
 */
export const AUTH_ROLE_DEFINITIONS = Object.freeze({
    user: ac.newRole({ user: [], session: [] }),
    staff: ac.newRole({ user: [], session: [] }),
    admin: ac.newRole({ user: ['list', 'get', 'create', 'set-role'], session: [] }),
});

/** Reduces Better Auth's role field (a comma-separated list) to the highest Nestrum role it contains. */
export function effectiveRole(value: unknown): AuthRole {
    const roles = typeof value === 'string' ? value.split(',').map((role) => role.trim()) : [];
    if (roles.includes('admin')) {
        return 'admin';
    }

    return roles.includes('staff') ? 'staff' : 'user';
}
