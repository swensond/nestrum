import type { Application, PrismaProvider } from '@nestrum/core';

export type ContractApplication = Pick<Application, 'apps' | 'database'>;

export type PrismaFragment = {
    readonly app: string;
    readonly path: string;
    readonly content: string;
};

export type PrismaContract = {
    readonly provider: PrismaProvider;
    readonly fragments: readonly PrismaFragment[];
    readonly source: string;
};

export type AssemblePrismaOptions = {
    readonly rootDir: string;
    readonly extensions?: readonly PrismaProviderExtension[];
};

export type PrismaProviderExtension = {
    readonly owner: string;
    readonly name: string;
    readonly provider: PrismaProvider;
    readonly contribute?: () => string | Promise<string>;
    readonly controlModule?: string;
};

export type GeneratePrismaOptions = AssemblePrismaOptions & {
    readonly outputDir: string;
    readonly timeoutMs?: number;
    readonly authoring?: 'native' | 'prisma7';
};

export type GeneratedPrismaContract = PrismaContract & {
    readonly configPath: string;
    readonly sourcePath: string;
    readonly contractPath: string;
    readonly typesPath: string;
};

export type PrismaGeneration = {
    readonly directory: string;
    readonly contract: GeneratedPrismaContract;
};
