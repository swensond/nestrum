import { AppError, modelIdentity } from '@nestrum/core';
import type { CompileMetadataOptions, FieldMetadata, ModelMetadata, RelationMetadata, ScalarKind } from './metadata.types.js';

export class PrismaMetadataError extends AppError {
    constructor(code: 'PRISMA_METADATA_INVALID' | 'PRISMA_CODEC_UNSUPPORTED' | 'PRISMA_MODEL_AMBIGUOUS', message: string) {
        super(code, message);
        this.name = 'PrismaMetadataError';
    }
}

const CODECS: Readonly<Record<string, ScalarKind>> = Object.freeze({
    'pg/text@1': 'string', 'pg/varchar@1': 'string', 'pg/uuid@1': 'string',
    'pg/int2@1': 'integer', 'pg/int4@1': 'integer', 'pg/int8@1': 'bigint',
    'pg/float4@1': 'number', 'pg/float8@1': 'number', 'pg/bool@1': 'boolean',
    'pg/timestamptz-date@1': 'date', 'pg/timestamp-date@1': 'date',
    'pg/date-string@1': 'date-string', 'pg/timestamptz-string@1': 'datetime-string',
    'pg/timestamptz-temporal@1': 'temporal-instant', 'pg/timestamp-temporal@1': 'temporal-datetime',
    'pg/date-temporal@1': 'temporal-date', 'pg/time-temporal@1': 'temporal-time',
    'mongo/string@1': 'string', 'mongo/objectId@1': 'string', 'mongo/int32@1': 'integer',
    'mongo/int64@1': 'bigint', 'mongo/double@1': 'number', 'mongo/bool@1': 'boolean', 'mongo/date@1': 'date'
});

type ObjectValue = Record<string, unknown>;

function invalid(path: string): never {
    throw new PrismaMetadataError('PRISMA_METADATA_INVALID', `Invalid Prisma 8 contract metadata at ${path}.`);
}

function object(value: unknown, path: string): ObjectValue {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        invalid(path);
    }

    return value as ObjectValue;
}

function text(value: unknown, path: string): string {
    if (typeof value !== 'string' || value.length === 0) {
        invalid(path);
    }

    return value;
}

function strings(value: unknown, path: string): readonly string[] {
    if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
        invalid(path);
    }

    return Object.freeze([...value]);
}

function flag(value: unknown, path: string, fallback?: boolean): boolean {
    if (value === undefined && fallback !== undefined) {
        return fallback;
    }
    if (typeof value !== 'boolean') {
        invalid(path);
    }

    return value;
}

function optionalObject(value: unknown, path: string): ObjectValue {
    return value === undefined ? {} : object(value, path);
}

export function compileModelMetadata(options: CompileMetadataOptions): readonly ModelMetadata[] {
    modelIdentity('Model', options.database);
    const contract = object(options.contract, 'contract');
    if (options.provider !== 'postgresql' && options.provider !== 'mongodb') {
        invalid('provider');
    }
    const target = options.provider === 'postgresql' ? 'postgres' : 'mongo';
    if (contract.schemaVersion !== '1' || contract.target !== target || contract.targetFamily !== (target === 'postgres' ? 'sql' : 'mongo')) {
        invalid('schemaVersion/target');
    }

    const namespaces = object(object(contract.domain, 'domain').namespaces, 'domain.namespaces');
    const storageNamespaces = object(object(contract.storage, 'storage').namespaces, 'storage.namespaces');
    const execution = optionalObject(contract.execution, 'execution');
    const mutations = optionalObject(execution.mutations, 'execution.mutations');
    const defaults = mutations.defaults ?? [];
    if (!Array.isArray(defaults)) {
        invalid('execution.mutations.defaults');
    }
    const defaultEntries = defaults.map((value) => {
        const entry = object(value, 'mutation default');
        const ref = object(entry.ref, 'mutation default.ref');
        return { entry, namespace: text(ref.namespace, 'default.namespace'), model: text(ref.entry, 'default.entry'), field: text(ref.field, 'default.field') };
    });
    const models: ModelMetadata[] = [];
    const identities = new Set<string>();

    for (const namespace of Object.keys(namespaces).sort()) {
        const domain = object(namespaces[namespace], namespace);
        const definitions = optionalObject(domain.models, `${namespace}.models`);
        const storage = object(storageNamespaces[namespace], `storage.${namespace}`);

        for (const name of Object.keys(definitions).sort()) {
            const identity = modelIdentity(name, options.database);
            if (identities.has(identity)) {
                throw new PrismaMetadataError('PRISMA_MODEL_AMBIGUOUS', `Multiple namespaces define ${identity}; canonical identities must be unique.`);
            }
            identities.add(identity);
            const definition = object(definitions[name], identity);
            const mapping = object(definition.storage, `${identity}.storage`);
            const mongo = options.provider === 'mongodb';
            const storageName = text(mongo ? mapping.collection : mapping.table, 'storage model name');
            const storageNamespace = mongo ? storage : object(storageNamespaces[text(mapping.namespaceId, 'storage namespace')], 'mapped storage namespace');
            const mappedEntries = object(storageNamespace.entries, 'mapped storage entries');
            const physical = object(object(mappedEntries[mongo ? 'collection' : 'table'], 'storage models')[storageName], 'storage model');
            const columns = mongo ? {} : object(physical.columns, 'columns');
            const fieldMappings = mongo ? {} : object(mapping.fields, 'field mappings');
            const primaryKey = optionalObject(physical.primaryKey, 'primaryKey');
            const primaryColumns = primaryKey.columns === undefined ? [] : strings(primaryKey.columns, 'primaryKey.columns');
            const validator = mongo ? object(physical.validator, 'validator') : {};
            const jsonSchema = mongo ? object(validator.jsonSchema, 'validator.jsonSchema') : {};
            const required = mongo ? strings(jsonSchema.required, 'validator.required') : [];
            const fields: FieldMetadata[] = [];
            const rawFields = object(definition.fields, `${identity}.fields`);

            for (const fieldName of Object.keys(rawFields).sort()) {
                const path = `${identity}.${fieldName}`;
                const field = object(rawFields[fieldName], path);
                const type = object(field.type, `${path}.type`);
                const codec = text(type.codecId, `${path}.codecId`);
                const kind = Object.hasOwn(CODECS, codec) ? CODECS[codec] : undefined;
                if (type.kind !== 'scalar' || !kind || !codec.startsWith(mongo ? 'mongo/' : 'pg/')) {
                    throw new PrismaMetadataError('PRISMA_CODEC_UNSUPPORTED', `Unsupported codec/type ${codec} at ${path}.`);
                }
                const columnName = mongo ? fieldName : text(object(fieldMappings[fieldName], `${path}.mapping`).column, `${path}.column`);
                const column = mongo ? {} : object(columns[columnName], `${path}.storage`);
                const mutation = defaultEntries.find((entry) => entry.namespace === (mongo ? namespace : mapping.namespaceId) && entry.model === storageName && entry.field === columnName)?.entry;
                let enumValues: readonly string[] | undefined;
                if (field.valueSet !== undefined) {
                    const ref = object(field.valueSet, `${path}.valueSet`);
                    if (ref.plane !== 'domain' || ref.entityKind !== 'enum') {
                        invalid(`${path}.valueSet`);
                    }
                    const enumNamespace = object(namespaces[text(ref.namespaceId, 'enum namespace')], 'enum namespace');
                    const enumeration = object(object(enumNamespace.enum, 'enums')[text(ref.entityName, 'enum name')], 'enum');
                    if (!Array.isArray(enumeration.members) || enumeration.members.length === 0) {
                        invalid(`${path}.enum.members`);
                    }
                    enumValues = Object.freeze(enumeration.members.map((member) => text(object(member, 'enum member').value, 'enum value')));
                    if (kind !== 'string') {
                        invalid(`${path}.enum codec`);
                    }
                }
                fields.push(Object.freeze({
                    name: fieldName, codec, kind,
                    nullable: flag(field.nullable, `${path}.nullable`),
                    optional: mongo ? !required.includes(fieldName) : false,
                    array: flag(field.many, `${path}.many`, false),
                    primaryKey: mongo ? fieldName === '_id' : primaryColumns.includes(columnName),
                    hasCreateDefault: column.default !== undefined || mutation?.onCreate !== undefined,
                    hasUpdateDefault: mutation?.onUpdate !== undefined,
                    ...(enumValues ? { enumValues } : {})
                }));
            }

            const relations: RelationMetadata[] = [];
            const rawRelations = optionalObject(definition.relations, `${identity}.relations`);
            for (const relationName of Object.keys(rawRelations).sort()) {
                const relation = object(rawRelations[relationName], 'relation');
                const to = object(relation.to, 'relation.to');
                const on = object(relation.on, 'relation.on');
                const targetNamespace = object(namespaces[text(to.namespace, 'relation namespace')], 'relation namespace');
                const targetModel = text(to.model, 'relation model');
                if (!Object.hasOwn(object(targetNamespace.models, 'relation models'), targetModel)) {
                    invalid(`${identity}.${relationName}.target`);
                }
                const localFields = strings(on.localFields, 'relation.localFields');
                const targetFields = strings(on.targetFields, 'relation.targetFields');
                const targetDefinition = object(object(targetNamespace.models, 'relation models')[targetModel], 'relation target model');
                const targetModelFields = object(targetDefinition.fields, 'relation target fields');
                if (localFields.length !== targetFields.length || localFields.some((field) => !Object.hasOwn(rawFields, field)) ||
                    targetFields.some((field) => !Object.hasOwn(targetModelFields, field))) {
                    invalid(`${identity}.${relationName}.on`);
                }
                relations.push(Object.freeze({ name: relationName, target: modelIdentity(targetModel, options.database), cardinality: text(relation.cardinality, 'relation.cardinality'),
                    nullable: flag(relation.nullable, 'relation.nullable'), localFields, targetFields }));
            }

            models.push(Object.freeze({ database: options.database, provider: options.provider, namespace, name, identity, fields: Object.freeze(fields), relations: Object.freeze(relations) }));
        }
    }

    return Object.freeze(models.sort((left, right) => left.identity < right.identity ? -1 : left.identity > right.identity ? 1 : 0));
}
