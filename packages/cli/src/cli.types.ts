import type { Application } from '@nestrum/core';
import type { GeneratePrismaOptions } from '@nestrum/prisma/node';

export type CliConfig = {
    readonly application: Application;
    readonly rootDir?: string;
    readonly outputDir?: string;
    readonly migrationsDir?: string;
    readonly authoring?: GeneratePrismaOptions['authoring'];
    readonly extensions?: GeneratePrismaOptions['extensions'];
    readonly timeoutMs?: number;
    readonly server?: ServerConfig;
};
export type ServerConfig = {
    readonly host?: string;
    readonly port?: number;
    /** Maximum time to wait for in-flight requests during shutdown (default 30000). */
    readonly drainTimeoutMs?: number;
};
export type DatabaseCommand = 'generate' | 'migrate' | 'status';
export type CliArguments = {
    readonly command: DatabaseCommand;
    readonly config: string;
    readonly database: string;
    readonly name?: string;
    readonly plan: boolean;
    readonly json: boolean;
    readonly confirm?: readonly string[];
};
