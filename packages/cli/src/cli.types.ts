import type { Application } from '@nestrum/core';
import type { GeneratePrismaOptions } from '@nestrum/prisma/node';
import type { WebConfig } from '@nestrum/web';

export type CliConfig = {
    readonly application: Application;
    readonly rootDir?: string;
    readonly outputDir?: string;
    /**
     * Contract emission directory (relative to `rootDir`). Prisma 8 emits the database facade inside a package that
     * depends on the provider, so applications point this at that package. Without it, `outputDir` is used by `db`
     * commands and `<build>/contracts` by `build` and `dev`.
     */
    readonly contractDir?: string;
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
    readonly name?: string;
    readonly plan: boolean;
    readonly json: boolean;
    readonly confirm?: readonly string[];
};
