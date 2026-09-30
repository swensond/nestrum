import type { Application } from '@nestrum/core';
import type { GeneratePrismaOptions } from '@nestrum/prisma/node';
import type { WebConfig } from '@nestrum/web';

export type CliConfig = {
    readonly application: Application;
    readonly rootDir?: string;
    readonly outputDir?: string;
    /**
     * Per-database contract emission directories (relative to `rootDir`). Prisma 8 allows one database facade per
     * package, so applications mixing providers emit each database inside a package that depends on that provider.
     * Databases not listed use `outputDir` (`db` commands) or `<build>/contracts` (`build`, `dev`).
     */
    readonly contractDirs?: Readonly<Record<string, string>>;
    readonly migrationsDir?: string;
    readonly authoring?: GeneratePrismaOptions['authoring'];
    readonly extensions?: GeneratePrismaOptions['extensions'];
    readonly timeoutMs?: number;
    readonly server?: ServerConfig;
    /** Hosted consumer UI, an application-owned Vite project. Off unless `enabled: true`. */
    readonly web?: WebConfig;
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
