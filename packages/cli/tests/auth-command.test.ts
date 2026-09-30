import type { Application } from '@nestrum/core';
import { describe, expect, it, vi } from 'vitest';
import { createAdministratorFor, parseAuthArguments, runAuthCommand } from '../src/index.js';

describe('auth create-admin arguments', () => {
    it('parses the email, optional name, promote flag and config', () => {
        expect(parseAuthArguments(['auth', 'create-admin', '--email', 'a@b.test'])).toEqual({
            command: 'create-admin',
            email: 'a@b.test',
            promote: false,
        });
        expect(
            parseAuthArguments([
                'auth',
                'create-admin',
                '--email',
                'a@b.test',
                '--name',
                'Ada Lovelace',
                '--promote',
                '--config',
                'x.mjs',
            ]),
        ).toEqual({ command: 'create-admin', email: 'a@b.test', name: 'Ada Lovelace', config: 'x.mjs', promote: true });
    });

    it.each([
        [['auth', 'create-admin']],
        [['auth', 'delete-admin', '--email', 'a@b.test']],
        [['db', 'create-admin', '--email', 'a@b.test']],
        [['auth', 'create-admin', '--email']],
        [['auth', 'create-admin', '--email', 'a@b.test', '--email', 'c@d.test']],
        [['auth', 'create-admin', '--email', 'a@b.test', '--promote', '--promote']],
        [['auth', 'create-admin', '--email', 'a@b.test', '--password', 'secret']],
    ])('rejects %j', (args) => {
        expect(() => parseAuthArguments(args)).toThrow(expect.objectContaining({ code: 'CLI_ARGUMENT_INVALID' }));
    });
});

describe('auth create-admin command', () => {
    const application = (
        createAdministrator = vi.fn(async () => ({ user: { email: 'a@b.test', role: 'admin' }, created: true })),
    ) => ({ auth: { createAdministrator }, authConfigured: true }) as unknown as Application;

    it('passes a trimmed email, a default name and the promote flag to Better Auth', async () => {
        const create = vi.fn(async () => ({ user: { email: 'ada@b.test', role: 'admin' }, created: true }));
        const result = await createAdministratorFor(
            application(create),
            { email: ' ada@b.test ', promote: false },
            'a-password-123',
        );
        expect(result).toEqual({ email: 'ada@b.test', role: 'admin', created: true });
        expect(create).toHaveBeenCalledWith({
            email: 'ada@b.test',
            name: 'ada',
            password: 'a-password-123',
            promoteExisting: false,
        });
        await createAdministratorFor(
            application(create),
            { email: 'ada@b.test', name: ' Ada ', promote: true },
            undefined,
        );
        expect(create).toHaveBeenLastCalledWith({
            email: 'ada@b.test',
            name: 'Ada',
            password: '',
            promoteExisting: true,
        });
    });

    it('refuses an application without authentication', async () => {
        await expect(
            createAdministratorFor(
                { auth: undefined } as unknown as Application,
                { email: 'a@b.test', promote: false },
                'x',
            ),
        ).rejects.toMatchObject({ code: 'CLI_AUTH_NOT_CONFIGURED' });
    });

    it('requires a previous build and never runs without one', async () => {
        await expect(
            runAuthCommand(
                { command: 'create-admin', email: 'a@b.test', promote: false },
                { cwd: import.meta.dirname, env: { NESTRUM_ADMIN_PASSWORD: 'a-password-123' } },
            ),
        ).rejects.toMatchObject({ code: expect.stringMatching(/^BUILD_/) });
    });
});
