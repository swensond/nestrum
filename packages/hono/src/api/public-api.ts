import type { RouteConfig } from '@hono/zod-openapi';
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { InferdiScope } from '@inferdi/hono';
import type { FieldMetadata, RegisteredResource, ResourceApiOperation } from '@nestrum/core';
import { AppError, QuerySetError } from '@nestrum/core';
import type { Context } from 'hono';
import type { RuntimeEnv } from '#hono/runtime/runtime.types';
import type { PublicApiOptions } from './api.types.js';
import {
    decodeBody,
    decodePrimaryKey,
    encodeResponse,
    temporalAdapter,
    wireFieldSchema,
    wireObjectSchema,
} from './transport.js';

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
const OPENAPI_PATH = '/api/openapi.json';
const OPENAPI_CONFIG = { openapi: '3.1.0' as const, info: { title: 'Nestrum public API', version: '0.0.0' } };
const ERROR_SCHEMA = z.object({
    error: z.object({
        code: z.string(),
        message: z.string(),
        reason: z.string().optional(),
        issues: z
            .array(
                z.object({ code: z.string(), path: z.array(z.union([z.string(), z.number()])), message: z.string() }),
            )
            .optional(),
    }),
});
const LIST_QUERY_SCHEMA = z.strictObject({
    limit: z
        .string()
        .regex(/^(0|[1-9][0-9]*)$/)
        .transform(Number)
        .pipe(z.number().int().min(0).max(MAX_LIST_LIMIT))
        .optional(),
    orderBy: z.string().min(1).optional(),
});
const EMPTY_QUERY_SCHEMA = z.strictObject({});
const METHODS = { list: 'get', retrieve: 'get', create: 'post', update: 'patch', delete: 'delete' } as const;

type PlannedRoute<Scope extends InferdiScope> = {
    readonly definition: ReturnType<typeof createRoute<RouteConfig['path'], RouteConfig>>;
    readonly handler: (context: Context<RuntimeEnv<Scope>>) => Promise<Response>;
};

export type PublicOpenApiDocument = ReturnType<OpenAPIHono['getOpenAPI31Document']>;

function pluralSlug(name: string): string {
    const slug = name
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replaceAll('_', '-')
        .toLowerCase();
    if (/[^aeiou]y$/.test(slug)) {
        return `${slug.slice(0, -1)}ies`;
    }
    if (/(s|x|z|ch|sh)$/.test(slug)) {
        return `${slug}es`;
    }

    return `${slug}s`;
}

function primaryKey(resource: RegisteredResource): FieldMetadata {
    const keys = resource.metadata.fields.filter((field) => field.primaryKey);
    const field = keys[0];
    if (
        keys.length !== 1 ||
        !field ||
        field.array ||
        field.nullable ||
        field.optional ||
        !resource.schemas.model.shape[field.name]
    ) {
        throw new AppError(
            'HTTP_API_PRIMARY_KEY_INVALID',
            `Item routes for ${resource.identity} require one nonnullable scalar primary key.`,
        );
    }

    return field;
}

function queryInput(context: Context, list: boolean): { limit?: number; orderBy?: string } {
    const parameters = new URL(context.req.url).searchParams;
    const input: Record<string, string> = {};
    for (const [key, value] of parameters) {
        if (Object.hasOwn(input, key)) {
            throw new AppError('VALIDATION_ERROR', 'Query parameters must not repeat.', 400);
        }
        Object.defineProperty(input, key, { value, enumerable: true });
    }

    return (list ? LIST_QUERY_SCHEMA : EMPTY_QUERY_SCHEMA).parse(input);
}

async function bodyInput(context: Context): Promise<unknown> {
    if (context.req.header('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
        throw new AppError('HTTP_UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.', 415);
    }
    try {
        return await context.req.json<unknown>();
    } catch {
        throw new AppError('VALIDATION_ERROR', 'Request body must contain valid JSON.', 400);
    }
}

function requireSingleMutation(count: number): void {
    if (count === 0) {
        throw new QuerySetError('QUERY_NOT_FOUND', 'No matching record.');
    }
    if (count !== 1) {
        throw new AppError('HTTP_MUTATION_RESULT_INVALID', 'Item mutation returned an invalid affected count.');
    }
}

function jsonResponse(context: Context, value: unknown, status: 200 | 201): Response {
    return context.newResponse(JSON.stringify(encodeResponse(value)), status, {
        'Content-Type': 'application/json; charset=UTF-8',
    });
}

function pathsOverlap(left: string, right: string): boolean {
    const first = left.split('/');
    const second = right.split('/');
    for (let index = 0; index < Math.max(first.length, second.length); index += 1) {
        const a = first[index];
        const b = second[index];
        if (a?.includes('*') || b?.includes('*')) {
            return true;
        }
        if (a === undefined || b === undefined) {
            return false;
        }
        if (a !== b && !a.startsWith(':') && !b.startsWith(':')) {
            return false;
        }
    }

    return true;
}

function planRoute<Scope extends InferdiScope>(
    resource: RegisteredResource,
    basePath: string,
    operation: ResourceApiOperation,
    options: PublicApiOptions,
): PlannedRoute<Scope> {
    const item = operation === 'retrieve' || operation === 'update' || operation === 'delete';
    const key = item ? primaryKey(resource) : undefined;
    const family = operation === 'create' ? 'create' : operation === 'update' ? 'update' : undefined;
    if (
        family &&
        resource.metadata.relations.some((relation) => Object.hasOwn(resource.schemas[family].shape, relation.name))
    ) {
        throw new AppError('HTTP_API_SCHEMA_INVALID', 'Public input schemas cannot expose nested relation writes.');
    }
    if (operation === 'update' && key && Object.hasOwn(resource.schemas.update.shape, key.name)) {
        throw new AppError('HTTP_API_SCHEMA_INVALID', 'Public Update schemas cannot expose the primary key.');
    }
    for (const field of resource.metadata.fields) {
        if (
            field.kind.startsWith('temporal-') &&
            ((family && resource.schemas[family].shape[field.name]) || field === key) &&
            !temporalAdapter(field, options)
        ) {
            throw new AppError(
                'HTTP_API_SCHEMA_INVALID',
                `Public input for ${resource.identity}.${field.name} requires a Temporal adapter.`,
            );
        }
    }
    const success = operation === 'create' ? 201 : operation === 'update' || operation === 'delete' ? 204 : 200;
    const readSchema = success !== 204 ? wireObjectSchema(resource, 'read') : undefined;
    const bodySchema = family
        ? wireObjectSchema(resource, family).openapi(family === 'update' ? { minProperties: 1 } : {})
        : undefined;
    const errors = Object.fromEntries(
        [400, 403, 404, 415, 500, 503].map((status) => [
            status,
            { description: 'Framework error.', content: { 'application/json': { schema: ERROR_SCHEMA } } },
        ]),
    );
    const definition = createRoute({
        method: METHODS[operation],
        path: item ? `${basePath}/{id}` : basePath,
        operationId: `${resource.identity}.${operation}`,
        tags: [resource.identity],
        request: {
            ...(operation === 'list' ? { query: LIST_QUERY_SCHEMA } : {}),
            // biome-ignore lint/style/noNonNullAssertion: primaryKey() rejects a model schema without the key field
            ...(key ? { params: z.object({ id: wireFieldSchema(key, resource.schemas.model.shape[key.name]!) }) } : {}),
            ...(bodySchema
                ? { body: { required: true, content: { 'application/json': { schema: bodySchema } } } }
                : {}),
        },
        responses: {
            ...errors,
            [success]: {
                description: success === 204 ? 'Mutation completed. No response body.' : 'Validated resource data.',
                ...(readSchema
                    ? {
                          content: {
                              'application/json': { schema: operation === 'list' ? z.array(readSchema) : readSchema },
                          },
                      }
                    : {}),
            },
        },
    });

    return {
        definition,
        handler: async (context) => {
            const parameters = queryInput(context, operation === 'list');
            const { subject, environment } = context.get('nestrum');
            const action = operation === 'list' || operation === 'retrieve' ? 'read' : operation;
            let query = resource.objects.authorizedFor(subject, action, environment);
            if (key) {
                const input = context.req.param('id');
                if (input === undefined) {
                    throw new AppError('VALIDATION_ERROR', 'Record ID is required.', 400);
                }
                // biome-ignore lint/style/noNonNullAssertion: primaryKey() rejects a model schema without the key field
                const keySchema = resource.schemas.model.shape[key.name]!;
                query = query.filterPrimaryKey(decodePrimaryKey(key, keySchema, input, options));
            }
            switch (operation) {
                case 'list': {
                    query = query.limit(parameters.limit ?? DEFAULT_LIST_LIMIT);
                    if (parameters.orderBy !== undefined) {
                        query = query.orderBy(...parameters.orderBy.split(','));
                    }

                    return jsonResponse(context, await query.all(), 200);
                }
                case 'retrieve':
                    return jsonResponse(context, await query.get(), 200);
                case 'create':
                    return jsonResponse(
                        context,
                        await query.create(decodeBody(resource, 'create', await bodyInput(context), options)),
                        201,
                    );
                case 'update': {
                    requireSingleMutation(
                        await query.update(decodeBody(resource, 'update', await bodyInput(context), options)),
                    );

                    return context.body(null, 204);
                }
                case 'delete': {
                    requireSingleMutation(await query.delete());

                    return context.body(null, 204);
                }
            }
        },
    };
}

export function registerPublicApi<Scope extends InferdiScope>(
    app: OpenAPIHono<RuntimeEnv<Scope>>,
    resources: readonly RegisteredResource[],
    options: PublicApiOptions = {},
): PublicOpenApiDocument {
    const router = new OpenAPIHono<RuntimeEnv<Scope>>();
    const paths = new Set<string>();
    const plans: PlannedRoute<Scope>[] = [];
    for (const resource of resources) {
        const operations = (Object.keys(METHODS) as ResourceApiOperation[]).filter(
            (operation) => resource.api[operation],
        );
        if (operations.length === 0) {
            continue;
        }
        const basePath = `/api/${resource.database === 'default' ? '' : `${resource.database}/`}${pluralSlug(resource.model)}`;
        if (paths.has(basePath)) {
            throw new AppError('HTTP_API_ROUTE_CONFLICT', `Public resource path ${basePath} is duplicated.`);
        }
        paths.add(basePath);
        for (const operation of operations) {
            plans.push(planRoute<Scope>(resource, basePath, operation, options));
        }
    }
    for (const plan of plans) {
        router.openAPIRegistry.registerPath(plan.definition);
        router.on(plan.definition.method.toUpperCase(), plan.definition.getRoutingPath(), plan.handler);
    }
    const routes = [...router.routes, ...(plans.length ? [{ method: 'GET', path: OPENAPI_PATH }] : [])];
    for (const [index, route] of routes.entries()) {
        if (
            routes
                .slice(0, index)
                .some((existing) => existing.method === route.method && pathsOverlap(existing.path, route.path))
        ) {
            throw new AppError(
                'HTTP_API_ROUTE_CONFLICT',
                `Generated public route ${route.method} ${route.path} overlaps another resource route.`,
            );
        }
        if (
            app.routes.some(
                (existing) =>
                    existing.method !== 'ALL' &&
                    existing.method === route.method &&
                    pathsOverlap(existing.path, route.path),
            )
        ) {
            throw new AppError(
                'HTTP_API_ROUTE_CONFLICT',
                `Public route ${route.method} ${route.path} conflicts with an existing route.`,
            );
        }
    }
    let document: PublicOpenApiDocument;
    try {
        document = router.getOpenAPI31Document(OPENAPI_CONFIG);
    } catch (cause) {
        throw new AppError('HTTP_API_SCHEMA_INVALID', 'Public schemas cannot be represented in OpenAPI.', 500, {
            cause,
        });
    }
    if (plans.length) {
        router.get(OPENAPI_PATH, (context) => context.json(document));
    }
    app.route('/', router);

    return document;
}
