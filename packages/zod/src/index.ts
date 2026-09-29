import type { FieldMetadata, ModelMetadata } from '@nestrum/prisma';
import { PrismaMetadataError } from '@nestrum/prisma';
import { z } from 'zod';

export type ModelSchemas = {
    readonly metadata: ModelMetadata;
    readonly names: Readonly<Record<'model' | 'create' | 'update' | 'read' | 'where' | 'orderBy', string>>;
    readonly model: z.ZodObject;
    readonly create: z.ZodObject;
    readonly update: z.ZodObject;
    readonly read: z.ZodObject;
    readonly where: z.ZodType;
    readonly orderBy: z.ZodObject;
};

export type SchemaGenerationOptions = {
    readonly temporal?: Readonly<
        Partial<Record<'Instant' | 'PlainDateTime' | 'PlainDate' | 'PlainTime', { readonly prototype: object }>>
    >;
};

function temporalSchema(
    name: 'Instant' | 'PlainDateTime' | 'PlainDate' | 'PlainTime',
    options: SchemaGenerationOptions,
): z.ZodType {
    return z.custom((value) => {
        const temporal =
            options.temporal ?? (globalThis as unknown as { Temporal?: SchemaGenerationOptions['temporal'] }).Temporal;
        const temporalClass = temporal?.[name];
        if (!temporalClass || typeof value !== 'object' || value === null) {
            return false;
        }

        try {
            temporalClass.prototype.toString.call(value);
            return Object.prototype.isPrototypeOf.call(temporalClass.prototype, value);
        } catch {
            return false;
        }
    }, `Expected Temporal.${name}; install a Temporal implementation when the runtime lacks it.`);
}

function scalarSchema(field: FieldMetadata, options: SchemaGenerationOptions): z.ZodType {
    if (field.enumValues) {
        return z.enum([...field.enumValues]);
    }

    switch (field.kind) {
        case 'string':
            return field.codec === 'mongo/objectId@1' ? z.string().regex(/^[0-9a-fA-F]{24}$/) : z.string();
        case 'integer': {
            const bits = field.codec === 'pg/int2@1' ? 16 : 32;
            return z
                .number()
                .int()
                .min(-(2 ** (bits - 1)))
                .max(2 ** (bits - 1) - 1);
        }
        case 'number':
            return z.number();
        case 'bigint':
            return z
                .bigint()
                .min(-(2n ** 63n))
                .max(2n ** 63n - 1n);
        case 'boolean':
            return z.boolean();
        case 'date':
            return z.date();
        case 'date-string':
            return z.iso.date();
        case 'datetime-string':
            return z.iso.datetime({ offset: true });
        case 'temporal-instant':
            return temporalSchema('Instant', options);
        case 'temporal-datetime':
            return temporalSchema('PlainDateTime', options);
        case 'temporal-date':
            return temporalSchema('PlainDate', options);
        case 'temporal-time':
            return temporalSchema('PlainTime', options);
    }
}

export function generateModelSchemas(metadata: ModelMetadata, options: SchemaGenerationOptions = {}): ModelSchemas {
    const modelShape: Record<string, z.ZodType> = Object.create(null) as Record<string, z.ZodType>;
    const createShape: Record<string, z.ZodType> = Object.create(null) as Record<string, z.ZodType>;
    const updateShape: Record<string, z.ZodType> = Object.create(null) as Record<string, z.ZodType>;
    const whereShape: Record<string, z.ZodType> = Object.create(null) as Record<string, z.ZodType>;
    const orderShape: Record<string, z.ZodType> = Object.create(null) as Record<string, z.ZodType>;

    for (const field of metadata.fields) {
        if (['AND', 'OR', 'NOT'].includes(field.name)) {
            throw new PrismaMetadataError(
                'PRISMA_METADATA_INVALID',
                `Field ${metadata.identity}.${field.name} conflicts with a reserved Where operator.`,
            );
        }
        const scalar = scalarSchema(field, options);
        let value = field.array ? z.array(scalar) : scalar;
        if (field.nullable) {
            value = value.nullable();
        }
        modelShape[field.name] = field.optional ? value.optional() : value;
        createShape[field.name] = field.optional || field.nullable || field.hasCreateDefault ? value.optional() : value;
        if (!field.primaryKey) {
            updateShape[field.name] = value.optional();
        }
        const filter: Record<string, z.ZodType> = { equals: value.optional() };
        if (!field.array) {
            filter.in = z.array(scalar).optional();
            filter.notIn = z.array(scalar).optional();
            filter.not = value.optional();
        }
        if (!field.array && !['boolean'].includes(field.kind)) {
            for (const operator of ['lt', 'lte', 'gt', 'gte']) {
                filter[operator] = scalar.optional();
            }
        }
        if (!field.array && field.kind === 'string' && !field.enumValues && field.codec !== 'mongo/objectId@1') {
            for (const operator of ['contains', 'startsWith', 'endsWith']) {
                filter[operator] = z.string().optional();
            }
        }
        if (field.array) {
            filter.has = scalar.optional();
            filter.hasEvery = z.array(scalar).optional();
            filter.hasSome = z.array(scalar).optional();
            filter.isEmpty = z.boolean().optional();
        }
        whereShape[field.name] = z.union([value, z.strictObject(filter)]).optional();
        orderShape[field.name] = z.enum(['asc', 'desc']).optional();
    }

    const where: z.ZodType = z.lazy(() =>
        z.strictObject({
            ...whereShape,
            AND: z.array(where).optional(),
            OR: z.array(where).optional(),
            NOT: z.union([where, z.array(where)]).optional(),
        }),
    );
    const model = z.strictObject(modelShape);

    return Object.freeze({
        metadata,
        names: Object.freeze({
            model: `${metadata.name}ModelSchema`,
            create: `${metadata.name}CreateSchema`,
            update: `${metadata.name}UpdateSchema`,
            read: `${metadata.name}ReadSchema`,
            where: `${metadata.name}WhereSchema`,
            orderBy: `${metadata.name}OrderBySchema`,
        }),
        model,
        create: z.strictObject(createShape),
        update: z.strictObject(updateShape),
        read: model,
        where,
        orderBy: z.strictObject(orderShape),
    });
}
