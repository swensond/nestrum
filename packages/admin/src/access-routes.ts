import type { AdminRequestContext, Application } from '@nestrum/core';
import { AuthorizationError } from '@nestrum/core';
import { jsonBody } from '@nestrum/hono';
import type { Hono } from 'hono';
import { z } from 'zod';
import { ADMIN_USERS_ACTION, ADMIN_USERS_IDENTITY } from './policies.js';

const LIST_QUERY = z
    .object({
        limit: z.coerce.number().int().min(1).max(100).default(25),
        offset: z.coerce.number().int().min(0).max(10_000).default(0),
        email: z.string().trim().min(1).max(254).optional(),
    })
    .strict();
const ROLE_BODY = z.object({ role: z.enum(['user', 'staff']) }).strict();
const USER_ID = z.string().min(1).max(128);

type Env = { Bindings: { readonly requestContext: AdminRequestContext } };

function respond(body: unknown, status = 200): Response {
    return Response.json(body, {
        status,
        headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=UTF-8' },
    });
}

/**
 * Staff management. These routes sit behind the full admin boundary (same origin, session, `admin.access`, two-factor
 * assurance); on top of that the subject needs `admin.users`/`manage`, and Better Auth re-checks the caller's role.
 * Administrators are never modified here.
 */
export function registerAccessRoutes<E extends Env>(router: Hono<E>, application: Application): void {
    function users() {
        // biome-ignore lint/style/noNonNullAssertion: the admin router requires configured authentication
        return application.auth!.users;
    }
    async function authorize(context: { env: E['Bindings'] }): Promise<boolean> {
        const { subject, environment } = context.env.requestContext;
        const decision = await application.authorization.authorize({
            identity: ADMIN_USERS_IDENTITY,
            action: ADMIN_USERS_ACTION,
            subject,
            environment,
        });

        return decision.allowed;
    }
    async function require(context: { env: E['Bindings'] }): Promise<void> {
        if (!(await authorize(context))) {
            throw new AuthorizationError('USER_MANAGEMENT_DENIED');
        }
    }

    router.get('/access/capabilities', async (context) => respond({ users: await authorize(context) }));
    router.get('/access/users', async (context) => {
        await require(context);
        const query = LIST_QUERY.parse(Object.fromEntries(new URL(context.req.url).searchParams));

        return respond(
            await users().list(context.req.raw, {
                limit: query.limit,
                offset: query.offset,
                ...(query.email === undefined ? {} : { email: query.email }),
            }),
        );
    });
    router.post('/access/users/:id/role', async (context) => {
        await require(context);
        const userId = USER_ID.parse(context.req.param('id'));
        const { role } = ROLE_BODY.parse(await jsonBody(context.req.raw));

        return respond({ user: await users().setRole(context.req.raw, { userId, role }) });
    });
}
