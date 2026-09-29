import type { ModelIdentity, PrismaProvider } from '#core/database/database.types';

export type ScalarKind = 'string' | 'integer' | 'number' | 'bigint' | 'boolean' | 'date' | 'date-string' | 'datetime-string' | 'temporal-instant' | 'temporal-datetime' | 'temporal-date' | 'temporal-time';

export type FieldMetadata = {
    readonly name: string;
    readonly codec: string;
    readonly kind: ScalarKind;
    readonly nullable: boolean;
    readonly optional: boolean;
    readonly array: boolean;
    readonly primaryKey: boolean;
    readonly hasCreateDefault: boolean;
    readonly hasUpdateDefault: boolean;
    readonly enumValues?: readonly string[];
};

export type RelationMetadata = {
    readonly name: string;
    readonly target: ModelIdentity;
    readonly cardinality: string;
    readonly nullable: boolean;
    readonly localFields: readonly string[];
    readonly targetFields: readonly string[];
};

export type ModelMetadata = {
    readonly database: string;
    readonly provider: PrismaProvider;
    readonly namespace: string;
    readonly name: string;
    readonly identity: ModelIdentity;
    readonly fields: readonly FieldMetadata[];
    readonly relations: readonly RelationMetadata[];
};

