import type { PrismaProvider } from '@nestrum/core';

export type { FieldMetadata, ModelMetadata, RelationMetadata, ScalarKind } from '@nestrum/core';

export type CompileMetadataOptions = {
    readonly database: string;
    readonly provider: PrismaProvider;
    readonly contract: unknown;
};
