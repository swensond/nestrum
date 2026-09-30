import type {
    AdminRequestContext,
    AdminTwoFactorPolicy,
    Application,
    AuthorizationEngine,
    AuthorizationEnvironment,
    AuthSession,
    ModelIdentity,
    QueryOperation,
    Subject,
} from '@nestrum/core';
import { AdminError, AdminTwoFactorRequiredError, AppError, AuthorizationError } from '@nestrum/core';

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
/** The session stays outside `AdminAccess`, which is spread into policy bindings. */
export type AdminAuthorization = { readonly access: AdminAccess; readonly session: AuthSession };

/**
 * `full` additionally requires the current session's second-factor assurance (when the policy demands it).
 * `challenge` is reserved for the narrow set of routes that establish that assurance.
 */
export type AdminAccessMode = 'full' | 'challenge';

/**
 * A live Better Auth session, a default-deny `admin.access` grant and (unless disabled) current-session
 * two-factor assurance are all required. Anonymous sessions never reach resource authorization.
 *
 * `admin.access` is decided before assurance is revealed, so a user who may not use administration learns nothing
 * about their factor state; both checks are always enforced.
 */
export async function authorizeAccess(
    application: Application,
    request: Request,
    context: AdminRequestContext,
    allowedOrigins: readonly string[],
    policy: AdminTwoFactorPolicy,
    mode: AdminAccessMode = 'full',
): Promise<AdminAuthorization> {
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
    if (mode === 'full' && policy.required) {
        const assurance = await authentication.twoFactor.assurance(session);
        if (assurance.level !== 'two-factor') {
            throw new AdminTwoFactorRequiredError(assurance.configured ? 'challenge-required' : 'setup-required');
        }
    }

    return { access: { subject: context.subject, environment: context.environment }, session };
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
