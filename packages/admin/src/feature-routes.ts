import type { AdminRequestContext, Application, FeatureRuleScope } from '@nestrum/core';
import { AppError, AuthorizationError, FEATURE_RULE_SCOPES } from '@nestrum/core';
import { jsonBody } from '@nestrum/hono';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { FeatureAction } from './policies.js';
import { FEATURE_ACTIONS, FEATURE_IDENTITY } from './policies.js';

const SCOPE = z.enum(FEATURE_RULE_SCOPES);
const RULE_BODY = z
    .object({
        scope: SCOPE,
        target: z.string().max(256).optional(),
        enabled: z.boolean().optional(),
        percentage: z.number().min(0).max(100).optional(),
    })
    .strict();
const REMOVE_QUERY = z.object({ scope: SCOPE, target: z.string().max(256).default('') }).strict();
// Only these three inputs shape an explanation; arbitrary attributes are never accepted or echoed back.
const EXPLAIN_BODY = z
    .object({
        subjectId: z.string().min(1).max(256).optional(),
        organizationId: z.string().min(1).max(256).optional(),
        environment: z.string().min(1).max(64).optional(),
    })
    .strict();

type Env = { Bindings: { readonly requestContext: AdminRequestContext } };

/** Feature configuration is never cacheable. */
function respond(body: unknown, status = 200): Response {
    return Response.json(body, {
        status,
        headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=UTF-8' },
    });
}

/**
 * Feature-flag management. Like API keys, these routes sit behind the whole admin boundary (same origin, Better Auth
 * session, `admin.access`, two-factor assurance) and each operation additionally needs its own `features` ABAC
 * action. Registered only when the application configures features. Overrides go through the manager, so every write
 * invalidates evaluation state and emits the audit event with the acting subject.
 */
export function registerFeatureRoutes<E extends Env>(router: Hono<E>, application: Application): void {
    if (!application.featuresConfigured) {
        return;
    }
    function features() {
        // biome-ignore lint/style/noNonNullAssertion: the application starts features before serving admin requests
        return application.features!;
    }
    async function permitted(context: { env: E['Bindings'] }, action: FeatureAction): Promise<boolean> {
        const { subject, environment } = context.env.requestContext;

        return (await application.authorization.authorize({ identity: FEATURE_IDENTITY, action, subject, environment }))
            .allowed;
    }
    async function require(context: { env: E['Bindings'] }, action: FeatureAction): Promise<void> {
        if (!(await permitted(context, action))) {
            throw new AuthorizationError('FEATURE_MANAGEMENT_DENIED');
        }
    }
    const actor = (context: { env: E['Bindings'] }): string | undefined => {
        const id = context.env.requestContext.subject.id;

        return typeof id === 'string' ? id : undefined;
    };

    router.get('/features/capabilities', async (context) =>
        respond(
            Object.fromEntries(
                await Promise.all(FEATURE_ACTIONS.map(async (action) => [action, await permitted(context, action)])),
            ),
        ),
    );
    router.get('/features', async (context) => {
        await require(context, 'read');
        const { registry, manager } = features();
        const rules = await manager.list();

        return respond({
            flags: registry.names().map((name) => {
                const definition = registry.get(name);

                return {
                    name,
                    default: definition.default,
                    exposeToClient: definition.exposeToClient === true,
                    ...(definition.description === undefined ? {} : { description: definition.description }),
                    rules: rules
                        .filter((rule) => rule.flag === name)
                        .map(({ id, scope, target, enabled, percentage, updatedBy, updatedAt }) => ({
                            id,
                            scope,
                            target,
                            enabled,
                            percentage,
                            updatedBy,
                            updatedAt,
                        })),
                };
            }),
        });
    });
    router.put('/features/:flag/rules', async (context) => {
        await require(context, 'manage');
        const body = RULE_BODY.parse(await jsonBody(context.req.raw));
        const rule = await features().manager.set(
            {
                flag: context.req.param('flag'),
                scope: body.scope,
                ...(body.target === undefined ? {} : { target: body.target }),
                ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
                ...(body.percentage === undefined ? {} : { percentage: body.percentage }),
            },
            actor(context),
        );

        return respond({ rule });
    });
    router.delete('/features/:flag/rules', async (context) => {
        await require(context, 'manage');
        const query = REMOVE_QUERY.parse(Object.fromEntries(new URL(context.req.url).searchParams));
        const removed = await features().manager.remove(
            context.req.param('flag'),
            query.scope as FeatureRuleScope,
            query.target,
            actor(context),
        );
        if (!removed) {
            throw new AppError('FEATURE_RULE_NOT_FOUND', 'No such feature override.', 404);
        }

        return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
    });
    router.post('/features/:flag/explain', async (context) => {
        await require(context, 'read');
        const body = EXPLAIN_BODY.parse(await jsonBody(context.req.raw));
        const evaluation = await features().evaluator.evaluate(context.req.param('flag'), {
            ...(body.subjectId === undefined ? {} : { stableId: body.subjectId }),
            ...(body.organizationId === undefined ? {} : { organizationId: body.organizationId }),
            ...(body.environment === undefined ? {} : { environment: body.environment }),
        });

        return respond({ evaluation });
    });
    // Anything else under the prefix, including a wrong method, is a 404 rather than a fallthrough to resources.
    router.all('/features/*', () => {
        throw new AppError('ADMIN_ROUTE_NOT_FOUND', 'Admin route not found.', 404);
    });
}
