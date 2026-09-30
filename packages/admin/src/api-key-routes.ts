import type { AdminRequestContext, Application } from '@nestrum/core';
import { AppError, AuthorizationError } from '@nestrum/core';
import { jsonBody } from '@nestrum/hono';
import type { Hono } from 'hono';
import { z } from 'zod';
import type { ApiKeyAction } from './policies.js';
import { API_KEY_ACTIONS, API_KEY_IDENTITY } from './policies.js';

const LIST_QUERY = z
    .object({
        limit: z.coerce.number().int().min(1).max(100).default(25),
        offset: z.coerce.number().int().min(0).max(10_000).default(0),
        ownerId: z.string().min(1).max(128).optional(),
    })
    .strict();
const CREATE_BODY = z
    .object({
        name: z.string().trim().min(1).max(64),
        ownerId: z.string().min(1).max(128),
        scopes: z.array(z.string().max(130)).max(64),
        expiresInDays: z.number().int().min(1).max(3650).optional(),
        rateLimit: z
            .object({
                enabled: z.boolean().optional(),
                requests: z.number().int().min(1).optional(),
                windowSeconds: z.number().int().min(1).optional(),
            })
            .strict()
            .optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
    })
    .strict();
const KEY_ID = z.string().min(1).max(128);

type Env = { Bindings: { readonly requestContext: AdminRequestContext } };

/** Secrets and key metadata are never cacheable. */
function respond(body: unknown, status = 200): Response {
    return Response.json(body, {
        status,
        headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=UTF-8' },
    });
}

/**
 * API-key management. Like staff management, these routes sit behind the full admin boundary (same origin, session,
 * `admin.access`, two-factor assurance); each operation then needs its own `api-key` ABAC action, so creating a key
 * specifically requires `api-key`/`create`. The secret appears only in the create and rotate responses.
 */
export function registerApiKeyRoutes<E extends Env>(router: Hono<E>, application: Application): void {
    function keys() {
        // biome-ignore lint/style/noNonNullAssertion: the admin router requires configured authentication
        return application.auth!.apiKeys;
    }
    async function permitted(context: { env: E['Bindings'] }, action: ApiKeyAction): Promise<boolean> {
        const { subject, environment } = context.env.requestContext;
        const decision = await application.authorization.authorize({
            identity: API_KEY_IDENTITY,
            action,
            subject,
            environment,
        });

        return decision.allowed;
    }
    async function require(context: { env: E['Bindings'] }, action: ApiKeyAction): Promise<void> {
        if (!(await permitted(context, action))) {
            throw new AuthorizationError('API_KEY_MANAGEMENT_DENIED');
        }
    }

    router.get('/api-keys/capabilities', async (context) =>
        respond(
            Object.fromEntries(
                await Promise.all(API_KEY_ACTIONS.map(async (action) => [action, await permitted(context, action)])),
            ),
        ),
    );
    router.get('/api-keys', async (context) => {
        await require(context, 'read');
        const query = LIST_QUERY.parse(Object.fromEntries(new URL(context.req.url).searchParams));

        return respond(
            await keys().list({
                limit: query.limit,
                offset: query.offset,
                ...(query.ownerId === undefined ? {} : { ownerId: query.ownerId }),
            }),
        );
    });
    router.post('/api-keys', async (context) => {
        await require(context, 'create');
        const body = CREATE_BODY.parse(await jsonBody(context.req.raw));

        return respond(
            await keys().create({
                name: body.name,
                ownerId: body.ownerId,
                scopes: body.scopes,
                ...(body.expiresInDays === undefined ? {} : { expiresInDays: body.expiresInDays }),
                ...(body.rateLimit === undefined ? {} : { rateLimit: body.rateLimit }),
                ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
            }),
            201,
        );
    });
    router.post('/api-keys/:id/revoke', async (context) => {
        await require(context, 'revoke');

        return respond({ key: await keys().revoke(KEY_ID.parse(context.req.param('id'))) });
    });
    router.post('/api-keys/:id/rotate', async (context) => {
        await require(context, 'rotate');

        return respond(await keys().rotate(KEY_ID.parse(context.req.param('id'))));
    });
    // Anything else under the prefix, including a wrong method, is a 404 rather than a fallthrough to resources.
    router.all('/api-keys/*', () => {
        throw new AppError('ADMIN_ROUTE_NOT_FOUND', 'Admin route not found.', 404);
    });
}
