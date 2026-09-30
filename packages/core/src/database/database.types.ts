export type PrismaProvider = 'postgresql';

/** The application's one database. Nestrum targets a single PostgreSQL database through Prisma 8. */
export type DatabaseDefinition = {
    readonly kind: 'prisma';
    readonly provider: PrismaProvider;
    readonly connection: string;
};

/** A model's canonical identity is its model name, unique within the application's one database. */
export type ModelIdentity = string;
