import { validateDatabaseDefinition } from '@nestrum/core';
import type { DatabaseDefinition, PrismaProvider } from '@nestrum/core';

export type PrismaDatabaseConfig = {
    readonly provider: PrismaProvider;
    readonly connection: string;
};

export function prismaDatabase(config: PrismaDatabaseConfig): DatabaseDefinition {
    const definition = { ...config, kind: 'prisma' as const };
    validateDatabaseDefinition(definition);

    return Object.freeze({ kind: definition.kind, provider: definition.provider, connection: definition.connection });
}

export { compileModelMetadata, PrismaMetadataError } from '#prisma/metadata/metadata.compiler';
export type { CompileMetadataOptions, FieldMetadata, ModelMetadata, RelationMetadata, ScalarKind } from '#prisma/metadata/metadata.types';
