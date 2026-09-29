import type { Application, PrismaProvider } from '@nestrum/core';

export type ContractApplication = Pick<Application, 'apps' | 'databases'>;

export type PrismaFragment = {
    readonly app: string;
    readonly path: string;
    readonly content: string;
};

export type PrismaContract = {
    readonly database: string;
    readonly provider: PrismaProvider;
    readonly fragments: readonly PrismaFragment[];
    readonly source: string;
};

export type AssemblePrismaOptions = {
    readonly rootDir: string;
};

export type GeneratePrismaOptions = AssemblePrismaOptions & {
    readonly outputDir: string;
    readonly timeoutMs?: number;
    readonly authoring?: Readonly<Record<string, 'native' | 'prisma7'>>;
};

export type GeneratedPrismaContract = PrismaContract & {
    readonly configPath: string;
    readonly sourcePath: string;
    readonly contractPath: string;
    readonly typesPath: string;
};

export type PrismaGeneration = {
    readonly directory: string;
    readonly contracts: readonly GeneratedPrismaContract[];
};
