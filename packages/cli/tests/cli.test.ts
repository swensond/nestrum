import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineApplication } from '@nestrum/core';
import type { GeneratedPrismaContract } from '@nestrum/prisma/node';
import { PrismaCommandError } from '@nestrum/prisma/node';
import { describe, expect, it, vi } from 'vitest';
import {
    defineCliConfig,
    installShutdownSignals,
    loadCliConfig,
    parseCliArguments,
    runDatabaseCommand,
} from '../src/index.js';

function setup() {
    const config = defineCliConfig({
        application: defineApplication({
            apps: [],
            database: { kind: 'prisma', provider: 'postgresql', connection: 'postgresql://secret' },
        }),
        rootDir: '/project',
    });
    const contract = {
        provider: 'postgresql',
        contractPath: '/artifact/contract.json',
        typesPath: '/artifact/contract.d.ts',
    } as GeneratedPrismaContract;
    const dependencies = {
        generate: vi.fn(async () => ({ directory: '/artifact', contract })),
        configure: vi.fn(async () => '/workflow/config.mjs'),
        execute: vi.fn(async () => ({ stdout: 'done', stderr: '' })),
    };

    return { config, dependencies };
}

describe('Nestrum database CLI', () => {
    it('installs removable signal handlers and does not overlap shutdown on repeated signals', async () => {
        const source = new EventEmitter();
        const error = new Error('cleanup');
        const shutdown = vi.fn(async () => {
            throw error;
        });
        const onError = vi.fn();
        const remove = installShutdownSignals({ shutdown }, { source, onError });
        source.emit('SIGINT');
        source.emit('SIGTERM');
        await Promise.resolve();
        expect(shutdown).toHaveBeenCalledOnce();
        expect(onError).toHaveBeenCalledWith(error);
        remove();
        remove();
        expect(source.listenerCount('SIGINT')).toBe(0);
        expect(source.listenerCount('SIGTERM')).toBe(0);
    });
    it('parses commands with explicit defaults', () => {
        expect(parseCliArguments(['db', 'generate'])).toEqual({
            command: 'generate',
            config: 'nestrum.config.ts',
            plan: false,
            json: false,
        });
        expect(parseCliArguments(['db', 'migrate', '--plan', '--name', 'initial', '--json'])).toMatchObject({
            command: 'migrate',
            plan: true,
            name: 'initial',
            json: true,
        });
    });
    it.each(
        [
            ['db', 'push'],
            ['db', 'generate', '--database', 'default'],
            ['db', 'generate', '--force'],
            ['db', 'generate', '--config', 'a', '--config', 'b'],
            ['db', 'status', '--plan'],
            ['db', 'migrate', '--name', 'bad'],
            ['db', 'migrate', '--plan', '--name', '../bad'],
        ].map((args) => ({ args })),
    )('rejects malformed command arguments: %j', ({ args }) => {
        expect(() => parseCliArguments(args)).toThrow(expect.objectContaining({ code: 'CLI_ARGUMENT_INVALID' }));
    });
    it('generates the contract without starting apps or delegating online commands', async () => {
        const { config, dependencies } = setup();
        const result = await runDatabaseCommand(config, parseCliArguments(['db', 'generate', '--json']), dependencies);
        expect(JSON.parse(result.stdout)).toMatchObject({ contract: '/artifact/contract.json' });
        expect(dependencies.generate).toHaveBeenCalledWith(
            config.application,
            expect.objectContaining({ rootDir: '/project' }),
        );
        expect(config.application.state).toBe('created');
        expect(dependencies.execute).not.toHaveBeenCalled();
    });
    it.each([
        { command: 'status', flags: [], prefix: ['migration', 'status'], online: true },
        {
            command: 'migrate',
            flags: ['--confirm', 'reviewed-token'],
            prefix: ['db', 'migrate', '--confirm', 'reviewed-token'],
            online: true,
        },
        { command: 'migrate', flags: ['--plan', '--name', 'initial'], prefix: ['migration', 'plan'], online: false },
    ])(
        'delegates $command with stable migrations and isolated connection settings',
        async ({ command, flags, prefix, online }) => {
            const { config, dependencies } = setup();
            await runDatabaseCommand(config, parseCliArguments(['db', command, ...flags]), dependencies);
            expect(dependencies.configure).toHaveBeenCalledWith(
                expect.objectContaining({ provider: 'postgresql' }),
                '/project/prisma/migrations',
            );
            expect(dependencies.execute).toHaveBeenCalledWith(
                expect.arrayContaining([...prefix, '--config', '/workflow/config.mjs', '--no-interactive']),
                online ? expect.objectContaining({ connection: 'postgresql://secret' }) : { cwd: '/project' },
            );
        },
    );
    it('preserves delegated exit codes and redacts connection URLs in failures and success output', async () => {
        const { config, dependencies } = setup();
        dependencies.execute.mockResolvedValueOnce({ stdout: 'postgresql://secret', stderr: 'postgresql://secret' });
        expect(await runDatabaseCommand(config, parseCliArguments(['db', 'status']), dependencies)).toEqual({
            stdout: '[redacted]',
            stderr: '[redacted]',
        });
        dependencies.execute.mockRejectedValueOnce(
            new PrismaCommandError(4, { cause: { stderr: 'drift postgresql://secret' } }),
        );
        await expect(
            runDatabaseCommand(config, parseCliArguments(['db', 'status']), dependencies),
        ).rejects.toMatchObject({
            code: 'CLI_DELEGATE_FAILED',
            exitCode: 4,
            message: expect.stringContaining('drift [redacted]'),
        });
    });
    it('rejects invalid config, started applications, and config import failures', async () => {
        const { config } = setup();
        expect(() => defineCliConfig({ ...config, timeoutMs: 0 })).toThrow();
        await config.application.start();
        expect(() => defineCliConfig(config)).toThrow(expect.objectContaining({ code: 'CLI_CONFIG_INVALID' }));
        await config.application.shutdown();
        const directory = await mkdtemp(join(tmpdir(), 'nestrum-cli-config-'));
        try {
            await writeFile(join(directory, 'invalid.mjs'), 'export default {};');
            await expect(loadCliConfig('invalid.mjs', directory)).rejects.toMatchObject({ code: 'CLI_CONFIG_INVALID' });
            await expect(loadCliConfig('missing.mjs', directory)).rejects.toMatchObject({
                code: 'CLI_CONFIG_LOAD_FAILED',
            });
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
});
