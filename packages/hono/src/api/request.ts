import { z } from '@hono/zod-openapi';
import type { FieldMetadata, RegisteredResource } from '@nestrum/core';
import { AppError } from '@nestrum/core';

export const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
export const LIST_QUERY_SCHEMA = z.strictObject({
    limit: z
        .string()
        .regex(/^(0|[1-9][0-9]*)$/)
        .transform(Number)
        .pipe(z.number().int().min(0).max(MAX_LIST_LIMIT))
        .optional(),
    orderBy: z.string().min(1).optional(),
});
const EMPTY_QUERY_SCHEMA = z.strictObject({});

/** Item routes require exactly one nonnullable scalar primary key present in the model schema. */
export function primaryKeyField(resource: RegisteredResource): FieldMetadata {
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

/** Collect search parameters once, rejecting repeats before schema validation. */
function parameters(request: Request): Record<string, string> {
    const input: Record<string, string> = {};
    for (const [key, value] of new URL(request.url).searchParams) {
        if (Object.hasOwn(input, key)) {
            throw new AppError('VALIDATION_ERROR', 'Query parameters must not repeat.', 400);
        }
        Object.defineProperty(input, key, { value, enumerable: true });
    }

    return input;
}

export function listQuery(request: Request): { limit?: number | undefined; orderBy?: string | undefined } {
    return LIST_QUERY_SCHEMA.parse(parameters(request));
}

export function itemQuery(request: Request): void {
    EMPTY_QUERY_SCHEMA.parse(parameters(request));
}

export async function jsonBody(request: Request): Promise<unknown> {
    if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
        throw new AppError('HTTP_UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.', 415);
    }
    try {
        return await request.json();
    } catch {
        throw new AppError('VALIDATION_ERROR', 'Request body must contain valid JSON.', 400);
    }
}
