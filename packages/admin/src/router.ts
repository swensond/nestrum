import type { AdminRequestContext, AdminTwoFactorPolicy, Application, AuthSession, QuerySet } from '@nestrum/core';
import { AdminError, AppError, AuthorizationError, QuerySetError, snapshotQueryValue } from '@nestrum/core';
import type { ScalarTransport } from '@nestrum/hono';
import {
    DEFAULT_LIST_LIMIT,
    decodeBody,
    decodePrimaryKey,
    encodeResponse,
    itemQuery,
    jsonBody,
    listQuery,
    mapHttpError,
    primaryKeyField,
} from '@nestrum/hono';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import type { AdminAccess } from '#admin/access';
import { assertSameOrigin, authorizeAccess, permits } from '#admin/access';
import type { AdminResourceMetadata } from '#admin/metadata';
import { resourceMetadata } from '#admin/metadata';
import type { AdminEntry, AdminOptions } from '#admin/registry';
import { CHALLENGE_ROUTES, registerTwoFactorRoutes } from '#admin/two-factor-routes';

export const ADMIN_BASE_PATH = '/__admin';
type Env = {
    Bindings: { readonly requestContext: AdminRequestContext };
    Variables: { access: AdminAccess; session: AuthSession };
};

function json(value: unknown, status = 200): Response {
    return Response.json(encodeResponse(value), {
        status,
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    });
}

function requireSingleMutation(count: number): void {
    if (count === 0) {
        throw new QuerySetError('QUERY_NOT_FOUND', 'No matching record.');
    }
    if (count !== 1) {
        throw new AdminError('ADMIN_CONFIG_INVALID', 'Admin item mutation affected an invalid number of records.');
    }
}

export function createAdminRouter(
    entries: readonly AdminEntry[],
    application: Application,
    options: AdminOptions,
    transport: ScalarTransport,
    twoFactor: AdminTwoFactorPolicy,
): Hono<Env> {
    const bySlug = new Map(entries.map((entry) => [entry.slug, entry]));
    const metadata = new Map(
        entries.map((entry) => [
            entry.slug,
            resourceMetadata(entry.resource, entry.slug, entry.primaryKey, {
                listDisplay: entry.listDisplay,
                fields: entry.fields,
                actions: entry.actions,
            }),
        ]),
    );
    const router = new Hono<Env>().basePath(ADMIN_BASE_PATH);
    router.onError(async (error, context) => {
        try {
            await context.env.requestContext.reportError?.(error);
        } catch {
            /* Error observers cannot replace the response. */
        }
        const mapped = mapHttpError(error);

        return context.json(mapped.body, mapped.status, mapped.headers);
    });
    router.use('*', async (context, next) => {
        assertSameOrigin(context.req.raw, options.allowedOrigins ?? []);
        await next();
    });
    router.use(
        '*',
        cors({
            origin: (origin, context) =>
                origin === new URL(context.req.url).origin || options.allowedOrigins?.includes(origin)
                    ? origin
                    : undefined,
            credentials: true,
            allowMethods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
            allowHeaders: ['Content-Type'],
        }),
    );
    router.use('*', async (context, next) => {
        // Exact method + path only: any other spelling (trailing slash, casing) fails closed to full assurance.
        const mode = CHALLENGE_ROUTES.has(`${context.req.method} ${new URL(context.req.url).pathname}`)
            ? 'challenge'
            : 'full';
        const authorization = await authorizeAccess(
            application,
            context.req.raw,
            context.env.requestContext,
            options.allowedOrigins ?? [],
            twoFactor,
            mode,
        );
        context.set('access', authorization.access);
        context.set('session', authorization.session);

        await next();
    });
    registerTwoFactorRoutes(router, application, twoFactor);

    function entry(slug: string): AdminEntry {
        const found = bySlug.get(slug);
        if (!found) {
            throw new AdminError('ADMIN_RESOURCE_NOT_FOUND', `Admin resource /${slug} is not registered.`);
        }

        return found;
    }

    async function visibleMetadata(
        target: AdminEntry,
        access: AdminAccess,
    ): Promise<AdminResourceMetadata | undefined> {
        const [list, create, update, remove] = await Promise.all([
            permits(application.authorization, target.identity, access, 'read', 'read'),
            permits(application.authorization, target.identity, access, 'create', 'create'),
            permits(application.authorization, target.identity, access, 'update', 'update'),
            permits(application.authorization, target.identity, access, 'delete', 'delete'),
        ]);
        if (!list && !create && !update && !remove) {
            return undefined;
        }
        const source = metadata.get(target.slug);
        if (!source) {
            throw new AdminError('ADMIN_CONFIG_INVALID', 'Admin metadata is missing.');
        }
        const actions = [];
        for (const action of source.actions) {
            try {
                await application.authorization.prepare(target.identity, { ...access, action: action.name });
                actions.push(action);
            } catch (error) {
                if (!(error instanceof AuthorizationError)) {
                    throw error;
                }
            }
        }

        return { ...source, actions, capabilities: { list, retrieve: list, create, update, delete: remove } };
    }

    function querySet(target: AdminEntry, action: string, access: AdminAccess): QuerySet {
        return target.resource.objects.authorizedFor(access.subject, action, access.environment);
    }

    function primaryKey(target: AdminEntry, raw: string): unknown {
        const field = primaryKeyField(target.resource);
        // biome-ignore lint/style/noNonNullAssertion: primaryKeyField() requires the key field in the model schema
        return decodePrimaryKey(field, target.resource.schemas.model.shape[field.name]!, raw, transport);
    }

    async function body(target: AdminEntry, family: 'create' | 'update', request: Request) {
        const decoded = decodeBody(target.resource, family, await jsonBody(request), transport);
        if (Object.keys(decoded).some((name) => target.fields[name]?.readOnly)) {
            throw new AppError('VALIDATION_ERROR', 'Read-only admin fields cannot be written.', 400);
        }

        return decoded;
    }

    router.get('/resources', async (context) => {
        const access = context.get('access');
        itemQuery(context.req.raw);
        const visible = [];
        for (const target of entries) {
            const found = await visibleMetadata(target, access);
            if (found) {
                visible.push(found);
            }
        }

        return json(visible);
    });

    router.get('/resources/:slug', async (context) => {
        itemQuery(context.req.raw);
        const found = await visibleMetadata(entry(context.req.param('slug')), context.get('access'));
        if (!found) {
            throw new AdminError('ADMIN_RESOURCE_NOT_FOUND', 'Admin resource is not available.');
        }

        return json(found);
    });

    router.get('/:slug', async (context) => {
        const target = entry(context.req.param('slug'));
        const access = context.get('access');
        const parameters = listQuery(context.req.raw);
        const rows = await querySet(target, 'read', access)
            .limit(parameters.limit ?? DEFAULT_LIST_LIMIT)
            .orderBy(...(parameters.orderBy ? parameters.orderBy.split(',') : []))
            .all();

        return json({ rows });
    });

    router.post('/:slug', async (context) => {
        const target = entry(context.req.param('slug'));
        const access = context.get('access');
        itemQuery(context.req.raw);
        const created = await querySet(target, 'create', access).create(await body(target, 'create', context.req.raw));

        return json(created, 201);
    });

    router.get('/:slug/:id', async (context) => {
        const target = entry(context.req.param('slug'));
        const access = context.get('access');
        itemQuery(context.req.raw);

        return json(
            await querySet(target, 'read', access)
                .filterPrimaryKey(primaryKey(target, context.req.param('id')))
                .get(),
        );
    });

    router.patch('/:slug/:id', async (context) => {
        const target = entry(context.req.param('slug'));
        const access = context.get('access');
        itemQuery(context.req.raw);
        requireSingleMutation(
            await querySet(target, 'update', access)
                .filterPrimaryKey(primaryKey(target, context.req.param('id')))
                .update(await body(target, 'update', context.req.raw)),
        );

        return new Response(null, { status: 204 });
    });

    router.delete('/:slug/:id', async (context) => {
        const target = entry(context.req.param('slug'));
        const access = context.get('access');
        itemQuery(context.req.raw);
        requireSingleMutation(
            await querySet(target, 'delete', access)
                .filterPrimaryKey(primaryKey(target, context.req.param('id')))
                .delete(),
        );

        return new Response(null, { status: 204 });
    });

    router.post('/:slug/:id/actions/:action', async (context) => {
        const target = entry(context.req.param('slug'));
        const action = context.req.param('action');
        if (!Object.hasOwn(target.actions, action)) {
            throw new AdminError('ADMIN_ACTION_UNKNOWN', `Admin action ${action} is not registered.`);
        }
        const access = context.get('access');
        itemQuery(context.req.raw);
        const configured = target.actions[action];
        const request = context.req.raw;
        const input = request.body === null ? {} : z.record(z.string(), z.unknown()).parse(await jsonBody(request));
        const validated = configured?.input
            ? z.record(z.string(), z.unknown()).parse(await configured.input.parseAsync(input))
            : input;
        const permission = await application.authorization.prepare(
            target.identity,
            { ...access, action },
            undefined,
            validated,
        );
        let objects = querySet(target, 'read', access).filterPrimaryKey(primaryKey(target, context.req.param('id')));
        if (permission.scope) {
            objects = objects.withinPolicyScope(permission.scope);
        }
        const record = await objects.get();
        try {
            await permission.checkObject(record);
        } catch (error) {
            if (error instanceof AuthorizationError) {
                throw new QuerySetError('QUERY_NOT_FOUND', `No matching ${target.identity} record.`);
            }
            throw error;
        }
        if (!configured?.handler) {
            throw new AdminError('ADMIN_ACTION_NOT_IMPLEMENTED', 'Custom action execution is not configured.');
        }
        const result = await configured.handler(
            Object.freeze({
                application,
                resource: target.resource,
                record: Object.freeze(snapshotQueryValue(record)),
                objects: querySet(target, action, access).filterPrimaryKey(primaryKey(target, context.req.param('id'))),
                subject: access.subject,
                environment: access.environment,
                request,
                input: validated,
            }),
        );

        return result === undefined ? new Response(null, { status: 204 }) : json({ result });
    });

    router.notFound(() => json({ error: { code: 'ADMIN_ROUTE_NOT_FOUND', message: 'Admin route not found.' } }, 404));

    return router;
}
