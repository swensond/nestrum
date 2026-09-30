import type { AuthAdministratorInput, AuthUserPage, AuthUserSummary, AuthUsers } from '@nestrum/core';
import { AppError } from '@nestrum/core';
import { APIError } from 'better-auth/api';
import type { createAuthInstance } from '#auth/auth';
import { ASSIGNABLE_ROLES, effectiveRole } from './roles.js';

type AuthInstance = ReturnType<typeof createAuthInstance>;
type UserRecord = Record<string, unknown> & { id: string };

function instant(value: unknown): string {
    const time = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : Number.NaN;

    return Number.isNaN(time) ? '' : new Date(time).toISOString();
}

export function summarize(user: UserRecord): AuthUserSummary {
    return Object.freeze({
        id: user.id,
        name: String(user.name ?? ''),
        email: String(user.email ?? ''),
        role: effectiveRole(user.role),
        twoFactorEnabled: user.twoFactorEnabled === true,
        createdAt: instant(user.createdAt),
    });
}

/** Better Auth failures become safe, status-carrying errors; its messages are not echoed. */
function rethrow(error: unknown): never {
    if (error instanceof AppError) {
        throw error;
    }
    const status = error instanceof APIError && Number.isInteger(error.statusCode) ? Number(error.statusCode) : 500;
    if (status === 401) {
        throw new AppError('AUTH_USER_MANAGEMENT_UNAUTHENTICATED', 'Sign in to manage users.', 401, { cause: error });
    }
    if (status === 403) {
        throw new AppError('AUTH_USER_MANAGEMENT_DENIED', 'You may not manage users.', 403, { cause: error });
    }
    if (status === 404) {
        throw new AppError('AUTH_USER_NOT_FOUND', 'User not found.', 404, { cause: error });
    }
    if (status === 400) {
        throw new AppError('AUTH_USER_MANAGEMENT_INVALID', 'The request is not valid.', 400, { cause: error });
    }
    throw error;
}

export function createUserManagement(instance: AuthInstance): AuthUsers {
    return Object.freeze({
        async list(request, query): Promise<AuthUserPage> {
            try {
                const result = (await instance.api.listUsers({
                    headers: request.headers,
                    query: {
                        limit: query.limit,
                        offset: query.offset,
                        sortBy: 'createdAt',
                        sortDirection: 'desc',
                        ...(query.email
                            ? {
                                  filterField: 'email',
                                  filterOperator: 'eq',
                                  filterValue: query.email.trim().toLowerCase(),
                              }
                            : {}),
                    },
                })) as unknown as { users: UserRecord[]; total: number };

                return Object.freeze({
                    users: Object.freeze(result.users.map(summarize)),
                    total: result.total,
                    limit: query.limit,
                    offset: query.offset,
                });
            } catch (error) {
                return rethrow(error);
            }
        },

        async setRole(request, input): Promise<AuthUserSummary> {
            if (!(ASSIGNABLE_ROLES as readonly unknown[]).includes(input.role) || typeof input.userId !== 'string') {
                throw new AppError(
                    'AUTH_USER_MANAGEMENT_INVALID',
                    'Only the user and staff roles can be assigned here.',
                    400,
                );
            }
            try {
                const target = (await instance.api.getUser({
                    headers: request.headers,
                    query: { id: input.userId },
                })) as unknown as UserRecord;
                if (effectiveRole(target.role) === 'admin') {
                    throw new AppError(
                        'AUTH_ADMIN_ROLE_PROTECTED',
                        'Administrator roles are managed with the CLI, not the admin interface.',
                        403,
                    );
                }
                const updated = (await instance.api.setRole({
                    headers: request.headers,
                    body: { userId: input.userId, role: input.role },
                })) as unknown as { user: UserRecord };

                return summarize(updated.user);
            } catch (error) {
                return rethrow(error);
            }
        },
    });
}

/** Operator bootstrap using Better Auth's internal adapter: no session, so it is only ever called from the CLI. */
export async function createAdministrator(instance: AuthInstance, input: AuthAdministratorInput) {
    const context = await instance.$context;
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name || name.length > 200) {
        throw new AppError('AUTH_ADMINISTRATOR_INVALID', 'An administrator needs a valid email and a name.', 400);
    }
    const existing = await context.internalAdapter.findUserByEmail(email);
    if (existing) {
        if (!input.promoteExisting) {
            throw new AppError(
                'AUTH_ADMINISTRATOR_EXISTS',
                'That email is already registered. Pass --promote to make the existing account an administrator.',
                409,
            );
        }
        const promoted =
            effectiveRole((existing.user as { role?: unknown }).role) !== 'admin'
                ? await context.internalAdapter.updateUser(existing.user.id, { role: 'admin' })
                : existing.user;

        return { user: summarize(promoted as UserRecord), created: false };
    }
    const { minPasswordLength, maxPasswordLength } = context.password.config;
    if (
        typeof input.password !== 'string' ||
        input.password.length < minPasswordLength ||
        input.password.length > maxPasswordLength
    ) {
        throw new AppError(
            'AUTH_ADMINISTRATOR_INVALID',
            `The password must be ${minPasswordLength} to ${maxPasswordLength} characters.`,
            400,
        );
    }
    const user = await context.internalAdapter.createUser(
        { email, name, emailVerified: true, role: 'admin' },
        { method: 'admin' },
    );
    await context.internalAdapter.linkAccount({
        userId: user.id,
        providerId: 'credential',
        accountId: user.id,
        password: await context.password.hash(input.password),
    });

    return { user: summarize(user as UserRecord), created: true };
}
