import type { Application } from '#core/application/application';
import type { AppDefinition } from '#core/application/application.types';
import type { Subject } from '#core/authorization/authorization.types';
import type { ModelIdentity } from '#core/database/database.types';
import type { ApiKeys } from './api-key.js';
import type { SsoProviders } from './sso.js';

export type AuthSession = {
    readonly user: Readonly<Record<string, unknown> & { id: string }>;
    readonly session: Readonly<Record<string, unknown> & { id: string; userId: string; expiresAt: Date }>;
};
/** Roles Nestrum manages. `admin` is created through the CLI; staff and users are managed by admins. */
export type AuthRole = 'user' | 'staff' | 'admin';
export type AuthUserSummary = {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly role: AuthRole;
    readonly twoFactorEnabled: boolean;
    readonly createdAt: string;
};
export type AuthUserPage = {
    readonly users: readonly AuthUserSummary[];
    readonly total: number;
    readonly limit: number;
    readonly offset: number;
};
/** Request-scoped user management. Better Auth enforces the caller's role; Nestrum ABAC gates the routes on top. */
export type AuthUsers = {
    list(
        request: Request,
        query: {
            /** Exact email address (case-insensitive); substring search is not supported by the storage layer yet. */ readonly email?: string;
            readonly limit: number;
            readonly offset: number;
        },
    ): Promise<AuthUserPage>;
    /** Only `user` and `staff` can be assigned, and only to users who are not administrators. */
    setRole(
        request: Request,
        input: { readonly userId: string; readonly role: 'user' | 'staff' },
    ): Promise<AuthUserSummary>;
};
export type AuthAdministratorInput = {
    readonly email: string;
    readonly name: string;
    readonly password: string;
    /** Promote an existing account instead of failing when the email is already registered. */
    readonly promoteExisting?: boolean;
};
export type Authentication = {
    readonly users: AuthUsers;
    readonly apiKeys: ApiKeys;
    /** Present only when `sso.enabled` is configured. */
    readonly sso?: SsoProviders;
    /** Operator bootstrap (CLI): create or promote an administrator without a session. Never reachable over HTTP. */
    createAdministrator(
        input: AuthAdministratorInput,
    ): Promise<{ readonly user: AuthUserSummary; readonly created: boolean }>;
    readonly basePath: '/api/auth';
    handle(request: Request): Promise<Response>;
    getSession(request: Request): Promise<AuthSession | null>;
    resolveSubject(request: Request): Promise<Subject>;
};
export type AuthenticationDefinition = {
    readonly kind: 'better-auth';
    readonly protectedModels: readonly ModelIdentity[];
    createApp(): AppDefinition;
    initialize(application: Application): Promise<Authentication>;
};
