export type PrismaProvider = 'postgresql' | 'mongodb';

export type DatabaseDefinition = {
    readonly kind: 'prisma';
    readonly provider: PrismaProvider;
    readonly connection: string;
};

export type DatabaseConfig = {
    readonly default: DatabaseDefinition;
    readonly [name: string]: DatabaseDefinition;
};

export type DatabaseEntry = readonly [name: string, definition: DatabaseDefinition];
export type ModelIdentity = `${string}.${string}`;
