import type {
    AdminRequestContext,
    Application,
    AuthorizationEngine,
    AuthorizationEnvironment,
    ModelIdentity,
    QueryOperation,
    Subject,
} from '@nestrum/core';
import { AdminError, AppError, AuthorizationError } from '@nestrum/core';

/** Capability identity and action evaluated for every admin request before data access. */
export const ADMIN_ACCESS_IDENTITY = 'admin.access';
export const ADMIN_ACCESS_ACTION = 'access';

function requestOrigin(request: Request): string | undefined {
    const origin = request.headers.get('origin');
    if (origin !== null) {
        return origin;
    }
    const referer = request.headers.get('referer');
    if (referer === null) {
        return undefined;
    }
    try {
        return new URL(referer).origin;
    } catch {
        return 'invalid';
    }
}

/** Same-origin by default; browsers omit Origin on same-origin GET requests. */
export function assertSameOrigin(request: Request, allowedOrigins: readonly string[]): void {
    const origin = requestOrigin(request);
    if (origin === undefined) {
        if (request.headers.get('sec-fetch-site') === 'cross-site') {
            throw new AdminError('ADMIN_ORIGIN_DENIED', 'Admin API requires same-origin requests.');
        }
        return;
    }
    const own = new URL(request.url).origin;
    if (origin === own || allowedOrigins.includes(origin)) {
        return;
    }
    throw new AdminError('ADMIN_ORIGIN_DENIED', 'Admin API requires same-origin requests.');
}

export type AdminAccess = {
    readonly subject: Subject;
    readonly environment: AuthorizationEnvironment;
};

/**
 * A live Better Auth session and a default-deny `admin.access` grant are both required.
 * Anonymous sessions never reach resource authorization.
 */
export async function authorizeAccess(
    application: Application,
    request: Request,
    context: AdminRequestContext,
    allowedOrigins: readonly string[],
): Promise<AdminAccess> {
    assertSameOrigin(request, allowedOrigins);
    const authentication = application.auth;
    if (!authentication) {
        throw new AppError('ADMIN_AUTHENTICATION_REQUIRED', 'Admin API requires configured authentication.', 500);
    }
    const session = await authentication.getSession(request);
    if (!session) {
        throw new AdminError('ADMIN_AUTHENTICATION_REQUIRED', 'Admin API requires an authenticated session.');
    }
    const decision = await application.authorization.authorize({
        identity: ADMIN_ACCESS_IDENTITY,
        action: ADMIN_ACCESS_ACTION,
        subject: context.subject,
        environment: context.environment,
    });
    if (!decision.allowed) {
        throw new AuthorizationError(decision.reason);
    }

    return { subject: context.subject, environment: context.environment };
}

/** Probe one operation without a collection scope, so capability metadata never touches a database. */
export async function permits(
    authorization: AuthorizationEngine,
    identity: ModelIdentity,
    access: AdminAccess,
    action: string,
    operation: QueryOperation,
): Promise<boolean> {
    try {
        await authorization.prepare(identity, { ...access, action }, operation);

        return true;
    } catch (error) {
        if (error instanceof AuthorizationError) {
            return false;
        }
        throw error;
    }
}
