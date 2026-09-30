import type { AdminRequestContext, Application, SsoActor } from '@nestrum/core';
import { AppError, AuthorizationError } from '@nestrum/core';
import { jsonBody } from '@nestrum/hono';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { SsoAction } from './policies.js';
import { SSO_ACTIONS, SSO_IDENTITY } from './policies.js';

const PROVIDER_ID = z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z][a-z0-9-]*[a-z0-9]$/);

type Env = { Bindings: { readonly requestContext: AdminRequestContext } };

/** Provider configuration is never cacheable, and no response contains a stored secret. */
function respond(body: unknown, status = 200): Response {
    return Response.json(body, {
        status,
        headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=UTF-8' },
    });
}

/**
 * Enterprise SSO provider management. Like API-key and feature management, these routes sit behind the full admin
 * boundary (same origin, session, `admin.access`, two-factor assurance); each operation then needs its own `sso`
 * ABAC action. Request bodies go to the registry unchanged: it validates them strictly and is the only writer.
 */
export function registerSsoRoutes<E extends Env>(router: Hono<E>, application: Application): void {
    function providers() {
        const sso = application.auth?.sso;
        if (!sso) {
            throw new AppError('ADMIN_ROUTE_NOT_FOUND', 'Admin route not found.', 404);
        }

        return sso;
    }
    async function permitted(context: { env: E['Bindings'] }, action: SsoAction): Promise<boolean> {
        const { subject, environment } = context.env.requestContext;
        const decision = await application.authorization.authorize({
            identity: SSO_IDENTITY,
            action,
            subject,
            environment,
        });

        return decision.allowed;
    }
    async function require(context: { env: E['Bindings'] }, action: SsoAction): Promise<void> {
        providers();
        if (!(await permitted(context, action))) {
            throw new AuthorizationError('SSO_MANAGEMENT_DENIED');
        }
    }
    function actor(context: { env: E['Bindings'] }): SsoActor {
        const id = context.env.requestContext.subject.id;

        return { actorId: typeof id === 'string' ? id : null };
    }
    const target = (context: { req: { param(name: string): string } }) =>
        PROVIDER_ID.parse(context.req.param('providerId'));

    router.get('/auth/sso/capabilities', async (context) => {
        const enabled = application.auth?.sso !== undefined;

        return respond({
            enabled,
            ...Object.fromEntries(
                await Promise.all(
                    SSO_ACTIONS.map(async (action) => [action, enabled && (await permitted(context, action))]),
                ),
            ),
        });
    });
    router.get('/auth/sso', async (context) => {
        await require(context, 'read');

        return respond({ providers: await providers().list() });
    });
    router.post('/auth/sso', async (context) => {
        await require(context, 'create');

        return respond(
            { provider: await providers().create((await jsonBody(context.req.raw)) as never, actor(context)) },
            201,
        );
    });
    router.get('/auth/sso/:providerId', async (context) => {
        await require(context, 'read');

        return respond({ provider: await providers().get(target(context)) });
    });
    router.patch('/auth/sso/:providerId', async (context) => {
        await require(context, 'update');

        return respond({
            provider: await providers().update(
                target(context),
                (await jsonBody(context.req.raw)) as never,
                actor(context),
            ),
        });
    });
    router.delete('/auth/sso/:providerId', async (context) => {
        await require(context, 'delete');
        await providers().delete(target(context), actor(context));

        return respond({ deleted: true });
    });
    router.post('/auth/sso/:providerId/test', async (context) => {
        await require(context, 'test');

        return respond({ result: await providers().test(target(context), actor(context)) });
    });
    router.post('/auth/sso/:providerId/enable', async (context) => {
        await require(context, 'enable');

        return respond({ provider: await providers().setEnabled(target(context), true, actor(context)) });
    });
    router.post('/auth/sso/:providerId/disable', async (context) => {
        await require(context, 'disable');

        return respond({ provider: await providers().setEnabled(target(context), false, actor(context)) });
    });
    // Domain verification changes what the provider trusts, so it needs `sso.update` like any other configuration.
    router.post('/auth/sso/:providerId/domain-verification', async (context) => {
        await require(context, 'update');

        return respond({ verification: await providers().requestDomainVerification(target(context), actor(context)) });
    });
    router.post('/auth/sso/:providerId/domain-verification/verify', async (context) => {
        await require(context, 'update');

        return respond({ provider: await providers().verifyDomain(target(context), actor(context)) });
    });
    router.all('/auth/sso/*', () => {
        throw new AppError('ADMIN_ROUTE_NOT_FOUND', 'Admin route not found.', 404);
    });
}
