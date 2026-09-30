import type { AdminTwoFactorPolicy, Application, AuthSession, SessionAssurance } from '@nestrum/core';
import { jsonBody } from '@nestrum/hono';
import type { Hono } from 'hono';
import { z } from 'zod';

/** Routes that establish assurance; every other admin route requires it. Method + path, exact match. */
export const CHALLENGE_ROUTES: ReadonlySet<string> = new Set([
    'GET /__admin/auth/2fa/status',
    'POST /__admin/auth/2fa/enroll/start',
    'POST /__admin/auth/2fa/enroll/confirm',
    'POST /__admin/auth/2fa/challenge',
    'POST /__admin/auth/2fa/recovery/verify',
]);

const CODE = z.object({ code: z.string().min(1).max(64) }).strict();

type Env = { Variables: { session: AuthSession } };

function respond(body: unknown, status = 200): Response {
    return Response.json(body, {
        status,
        headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=UTF-8' },
    });
}

function assuranceBody(assurance: SessionAssurance) {
    return {
        level: assurance.level,
        configured: assurance.configured,
        ...(assurance.method === undefined ? {} : { method: assurance.method }),
        ...(assurance.expiresAt === undefined ? {} : { expiresAt: assurance.expiresAt.toISOString() }),
    };
}

/**
 * Private second-factor API. Responses are never cacheable. Secret and recovery-code material appears only in
 * the one response that issues it.
 */
export function registerTwoFactorRoutes<E extends Env>(
    router: Hono<E>,
    application: Application,
    policy: AdminTwoFactorPolicy,
): void {
    function service() {
        // biome-ignore lint/style/noNonNullAssertion: the admin router requires configured authentication
        return application.auth!.twoFactor;
    }
    async function code(request: Request): Promise<string> {
        return CODE.parse(await jsonBody(request)).code;
    }

    router.get('/auth/2fa/status', async (context) =>
        respond({ required: policy.required, ...assuranceBody(await service().assurance(context.get('session'))) }),
    );
    router.post('/auth/2fa/enroll/start', async (context) =>
        respond(await service().beginEnrollment(context.get('session')), 201),
    );
    router.post('/auth/2fa/enroll/confirm', async (context) => {
        const grant = await service().confirmEnrollment(
            context.get('session'),
            await code(context.req.raw),
            policy.assuranceTtlSeconds,
        );

        return respond({ assurance: assuranceBody(grant.assurance), recoveryCodes: grant.recoveryCodes });
    });
    router.post('/auth/2fa/challenge', async (context) => {
        const grant = await service().verifyTotp(
            context.get('session'),
            await code(context.req.raw),
            policy.assuranceTtlSeconds,
        );

        return respond({ assurance: assuranceBody(grant.assurance) });
    });
    router.post('/auth/2fa/recovery/verify', async (context) => {
        const grant = await service().verifyRecovery(
            context.get('session'),
            await code(context.req.raw),
            policy.assuranceTtlSeconds,
        );

        return respond({
            assurance: assuranceBody(grant.assurance),
            recoveryCodesRemaining: grant.recoveryCodesRemaining,
        });
    });
    // Requires full assurance: a session that merely used a recovery code still has it, but a bare login does not.
    router.post('/auth/2fa/recovery/regenerate', async (context) =>
        respond({ recoveryCodes: await service().regenerateRecoveryCodes(context.get('session')) }),
    );
}
