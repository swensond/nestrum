import { z } from '@hono/zod-openapi';
import type { FieldMetadata, RegisteredResource } from '@nestrum/core';
import { AppError } from '@nestrum/core';
import type { PublicApiOptions, TemporalType } from './api.types.js';

const TEMPORAL_TYPES: Readonly<Partial<Record<FieldMetadata['kind'], TemporalType>>> = {
    'temporal-instant': 'Instant',
    'temporal-datetime': 'PlainDateTime',
    'temporal-date': 'PlainDate',
    'temporal-time': 'PlainTime',
};

export function temporalAdapter(
    field: FieldMetadata,
    options: PublicApiOptions,
): { from(value: string): unknown } | undefined {
    const name = TEMPORAL_TYPES[field.kind];
    const temporal = (globalThis as unknown as { Temporal?: PublicApiOptions['temporal'] }).Temporal;

    return name ? (options.temporal?.[name] ?? temporal?.[name]) : undefined;
}

function scalarWireSchema(field: FieldMetadata): z.ZodType | undefined {
    switch (field.kind) {
        case 'date':
        case 'temporal-instant':
            return z.iso.datetime({ offset: true });
        case 'bigint':
            return z
                .string()
                .regex(/^-?(0|[1-9][0-9]*)$/)
                .openapi({ description: 'Signed 64-bit integer encoded as a decimal string.' });
        case 'temporal-datetime':
            return z.iso
                .datetime({ local: true })
                .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?$/)
                .openapi({ format: 'local-date-time' });
        case 'temporal-date':
            return z.iso.date();
        case 'temporal-time':
            return z.iso.time();
        default:
            return undefined;
    }
}

export function wireFieldSchema(field: FieldMetadata, schema: z.ZodType): z.ZodType {
    const scalar = scalarWireSchema(field);
    if (!scalar) {
        return schema;
    }
    let wire: z.ZodType = field.array ? z.array(scalar) : scalar;
    if (schema.isNullable()) {
        wire = wire.nullable();
    }
    if (schema.isOptional()) {
        wire = wire.optional();
    }

    return wire;
}

export function wireObjectSchema(resource: RegisteredResource, family: 'create' | 'update' | 'read'): z.ZodObject {
    const schema = resource.schemas[family];
    const shape: Record<string, z.ZodType> = {};
    for (const field of resource.metadata.fields) {
        const value = schema.shape[field.name];
        if (value && scalarWireSchema(field)) {
            shape[field.name] = wireFieldSchema(field, value);
        }
    }

    return schema.safeExtend(shape).strict();
}

function decodeScalar(field: FieldMetadata, value: unknown, options: PublicApiOptions): unknown {
    if (value === null || value === undefined) {
        return value;
    }
    switch (field.kind) {
        case 'date':
            return new Date(value as string);
        case 'bigint':
            return BigInt(value as string);
        case 'temporal-instant':
        case 'temporal-datetime':
        case 'temporal-date':
        case 'temporal-time': {
            const adapter = temporalAdapter(field, options);
            if (!adapter) {
                throw new AppError('HTTP_API_SCHEMA_INVALID', 'Temporal input adapter is missing.');
            }
            try {
                return adapter.from(value as string);
            } catch {
                throw new AppError('VALIDATION_ERROR', `Invalid ${field.name} temporal value.`, 400);
            }
        }
        default:
            return value;
    }
}

export function decodeBody(
    resource: RegisteredResource,
    family: 'create' | 'update',
    input: unknown,
    options: PublicApiOptions,
): Record<string, unknown> {
    const value = z.record(z.string(), z.unknown()).parse(input);
    const decoded = { ...value };
    const schema = resource.schemas[family];
    if (Object.keys(value).some((key) => !Object.hasOwn(schema.shape, key))) {
        throw new AppError('VALIDATION_ERROR', 'Unknown input field.', 400);
    }
    // QuerySet applies the composed runtime schema once, after decoding native scalar values.
    for (const field of resource.metadata.fields) {
        const fieldSchema = schema.shape[field.name];
        if (!Object.hasOwn(value, field.name) || !fieldSchema || !scalarWireSchema(field)) {
            continue;
        }
        const parsed = wireFieldSchema(field, fieldSchema).parse(value[field.name]);
        decoded[field.name] =
            field.array && Array.isArray(parsed)
                ? parsed.map((entry) => decodeScalar(field, entry, options))
                : decodeScalar(field, parsed, options);
    }
    if (family === 'update' && Object.keys(value).length === 0) {
        throw new AppError('VALIDATION_ERROR', 'Update data must not be empty.', 400);
    }

    return decoded;
}

export function decodePrimaryKey(
    field: FieldMetadata,
    schema: z.ZodType,
    value: string,
    options: PublicApiOptions,
): unknown {
    if (field.kind === 'integer' || field.kind === 'number') {
        return z
            .string()
            .regex(/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/)
            .transform(Number)
            .pipe(z.number().finite())
            .parse(value);
    }
    if (field.kind === 'boolean') {
        return z
            .enum(['true', 'false'])
            .transform((input) => input === 'true')
            .parse(value);
    }
    if (!scalarWireSchema(field)) {
        return value;
    }
    const parsed = wireFieldSchema(field, schema).parse(value);

    return decodeScalar(field, parsed, options);
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function encodeValue(value: unknown, ancestors = new Set<object>()): JsonValue {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'bigint') {
        return value.toString();
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (typeof value !== 'object' || value === null || ancestors.has(value)) {
        throw new Error('Result is not JSON serializable.');
    }
    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            return value.map((entry) => encodeValue(entry, ancestors));
        }
        const candidate = value as { toJSON?: () => unknown };
        if (typeof candidate.toJSON === 'function') {
            return encodeValue(candidate.toJSON(), ancestors);
        }
        if (![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)) {
            throw new Error('Unsupported result representation.');
        }

        return Object.fromEntries(
            Object.entries(value)
                .filter(([, entry]) => entry !== undefined)
                .map(([key, entry]) => [key, encodeValue(entry, ancestors)]),
        );
    } finally {
        ancestors.delete(value);
    }
}

export function encodeResponse(value: unknown): JsonValue {
    try {
        return encodeValue(value);
    } catch (cause) {
        throw new AppError('HTTP_RESPONSE_INVALID', 'Response serialization failed.', 500, { cause });
    }
}
