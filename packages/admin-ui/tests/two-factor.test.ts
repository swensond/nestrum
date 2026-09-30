import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import { AdminMetadataClient, loadAdminState } from '../src/lib/metadata.js';
import { isAuthPath, safeReturnTo, twoFactorHref, withNext } from '../src/lib/return-to.js';
import { TwoFactorClient } from '../src/lib/two-factor-client.js';
import { load as loadLayout } from '../src/routes/+layout.server.js';
import { load as loadChallenge } from '../src/routes/auth/2fa/+page.server.js';
import ChallengePage from '../src/routes/auth/2fa/+page.svelte';
import { load as loadSetup } from '../src/routes/auth/2fa/setup/+page.server.js';
import SetupPage from '../src/routes/auth/2fa/setup/+page.svelte';
import { load as loadRecovery } from '../src/routes/auth/recovery/+page.server.js';
import RecoveryPage from '../src/routes/auth/recovery/+page.svelte';
import ShellFixture from './ShellFixture.svelte';

const REQUIRED = (reason: string) =>
    Response.json(
        { error: { code: 'ADMIN_2FA_REQUIRED', message: 'Admin access requires two-factor verification.', reason } },
        { status: 403 },
    );

function form(values: Record<string, string | string[]>) {
    const data = new FormData();
    for (const [name, value] of Object.entries(values)) {
        for (const item of Array.isArray(value) ? value : [value]) {
            data.append(name, item);
        }
    }

    return new Request('http://localhost/admin/auth/2fa', { method: 'POST', body: data });
}
async function redirected(promise: Promise<unknown>) {
    try {
        await promise;
    } catch (error) {
        return error as { status: number; location: string };
    }
    throw new Error('Expected a redirect.');
}

describe('Return URL safety', () => {
    it.each([
        ['/admin/projects', '/admin/projects'],
        ['/admin/projects?limit=50&orderBy=-name', '/admin/projects?limit=50&orderBy=-name'],
        ['/admin', '/admin'],
        ['/admin/projects#fragment', '/admin/projects'],
        ['/admin/projects/%2e%2e/%2e%2e/etc', '/admin'],
    ])('keeps %s as %s', (input, expected) => {
        expect(safeReturnTo(input)).toBe(expected);
    });

    it.each([
        undefined,
        null,
        42,
        '',
        'admin/projects',
        'https://evil.example/admin',
        '//evil.example/admin',
        '/\\evil.example',
        '/admin\\..\\..',
        '/admin/../evil',
        '/administrator',
        '/api/auth/sign-out',
        '/__admin/resources',
        '/admin/auth/2fa',
        '/admin/auth/recovery?next=/admin',
        '/admin/auth',
        '/admin/projects\n',
        `/admin/${'a'.repeat(3000)}`,
        'javascript:alert(1)',
    ])('replaces %j with the admin home', (input) => {
        expect(safeReturnTo(input)).toBe('/admin');
    });

    it('builds setup and challenge destinations that carry only a safe return path', () => {
        expect(twoFactorHref('challenge-required', new URL('http://x/admin/projects?limit=50'))).toBe(
            '/admin/auth/2fa?next=%2Fadmin%2Fprojects%3Flimit%3D50',
        );
        expect(twoFactorHref('setup-required', new URL('http://x/admin'))).toBe('/admin/auth/2fa/setup');
        expect(withNext('/admin/auth/recovery', '/admin/projects')).toBe(
            '/admin/auth/recovery?next=%2Fadmin%2Fprojects',
        );
        expect(isAuthPath('/admin/auth/2fa')).toBe(true);
        expect(isAuthPath('/admin/authors')).toBe(false);
    });
});

describe('Two-factor shell state', () => {
    it('turns a structured ADMIN_2FA_REQUIRED denial into a two-factor state without leaking details', async () => {
        for (const reason of ['setup-required', 'challenge-required'] as const) {
            const state = await loadAdminState(async () => REQUIRED(reason));
            expect(state).toEqual({
                status: 'two-factor',
                reason,
                message: 'Two-factor verification is required.',
            });
        }
        // An unstructured 403 is still plain denial.
        expect((await loadAdminState(async () => Response.json({}, { status: 403 }))).status).toBe('denied');
        expect(
            (
                await loadAdminState(async () =>
                    Response.json({ error: { code: 'ADMIN_2FA_REQUIRED', reason: 'x' } }, { status: 403 }),
                )
            ).status,
        ).toBe('denied');
        await expect(
            new AdminMetadataClient(async () => REQUIRED('challenge-required')).resources(),
        ).rejects.toMatchObject({
            status: 403,
            reason: 'challenge-required',
        });
    });

    it('redirects browser navigation to setup or challenge with the intended URL, but never loops on auth pages', async () => {
        const event = (path: string, response: Response) =>
            ({
                fetch: vi.fn(async () => response.clone()),
                depends: vi.fn(),
                url: new URL(`http://localhost${path}`),
            }) as never;
        expect(
            await redirected(loadLayout(event('/admin/projects?limit=50', REQUIRED('challenge-required'))) as never),
        ).toMatchObject({
            status: 303,
            location: '/admin/auth/2fa?next=%2Fadmin%2Fprojects%3Flimit%3D50',
        });
        expect(await redirected(loadLayout(event('/admin', REQUIRED('setup-required'))) as never)).toMatchObject({
            status: 303,
            location: '/admin/auth/2fa/setup',
        });
        const onAuthPage = await loadLayout(event('/admin/auth/2fa', REQUIRED('challenge-required')));
        expect(onAuthPage.admin.status).toBe('two-factor');
        const signedOut = await loadLayout(event('/admin/projects', Response.json({}, { status: 401 })));
        expect(signedOut.admin.status).toBe('sign-in');
    });

    it('renders framework pages inside the shell only for a session that needs a second factor', async () => {
        const output = await render(ShellFixture, {
            props: { state: { status: 'two-factor', reason: 'challenge-required', message: 'x' } },
        });
        expect(output.body).toContain('Sign out');
        expect(output.body).not.toContain('Admin resources');
    });
});

describe('Shell on framework auth pages', () => {
    it('shows framework pages, not the sign-in form, to a pending second-factor sign-in only on auth paths', async () => {
        const state = { status: 'sign-in', message: 'Sign in to open administration.' } as const;
        const onAuth = await render(ShellFixture, { props: { state, activePath: '/admin/auth/2fa' } });
        expect(onAuth.body).toContain('Protected workspace content');
        expect(onAuth.body).not.toContain('name="password"');
        const elsewhere = await render(ShellFixture, { props: { state, activePath: '/admin/projects' } });
        expect(elsewhere.body).toContain('name="password"');
        expect(elsewhere.body).not.toContain('Protected workspace content');
    });
});

describe('Two-factor page loads', () => {
    const parent = (admin: unknown) => vi.fn(async () => ({ admin, path: '' })) as never;
    const url = (path: string) => new URL(`http://localhost${path}`);
    const pending = { status: 'two-factor', reason: 'challenge-required', message: '' };

    it('serves the challenge page to a challenged session and sanitizes next', async () => {
        expect(
            await loadChallenge({
                parent: parent(pending),
                url: url('/admin/auth/2fa?next=https://evil.example'),
            } as never),
        ).toEqual({
            next: '/admin',
        });
        expect(
            await loadChallenge({ parent: parent(pending), url: url('/admin/auth/2fa?next=/admin/projects') } as never),
        ).toEqual({
            next: '/admin/projects',
        });
    });

    it('sends verified sessions onward and unconfigured users to setup', async () => {
        const ready = { status: 'ready', resources: [] };
        expect(
            await redirected(
                loadChallenge({
                    parent: parent(ready),
                    url: url('/admin/auth/2fa?next=/admin/projects'),
                } as never) as never,
            ),
        ).toMatchObject({ status: 303, location: '/admin/projects' });
        expect(
            await redirected(
                loadRecovery({ parent: parent(ready), url: url('/admin/auth/recovery?next=//evil') } as never) as never,
            ),
        ).toMatchObject({ location: '/admin' });
        const setup = { status: 'two-factor', reason: 'setup-required', message: '' };
        expect(
            await redirected(
                loadChallenge({
                    parent: parent(setup),
                    url: url('/admin/auth/2fa?next=/admin/projects'),
                } as never) as never,
            ),
        ).toMatchObject({ location: '/admin/auth/2fa/setup?next=%2Fadmin%2Fprojects' });
        expect(
            await redirected(
                loadRecovery({ parent: parent(setup), url: url('/admin/auth/recovery') } as never) as never,
            ),
        ).toMatchObject({ location: '/admin/auth/2fa/setup' });
        expect(
            await redirected(
                loadSetup({
                    parent: parent(pending),
                    url: url('/admin/auth/2fa/setup?next=/admin/x'),
                } as never) as never,
            ),
        ).toMatchObject({ location: '/admin/auth/2fa?next=%2Fadmin%2Fx' });
    });

    it('does not redirect the setup page away from a freshly verified session, which still has recovery codes to show', async () => {
        expect(
            await loadSetup({
                parent: parent({ status: 'ready', resources: [] }),
                url: url('/admin/auth/2fa/setup'),
            } as never),
        ).toEqual({
            next: '/admin',
        });
    });
});

describe('Two-factor browser client', () => {
    const ok = (body: unknown = {}) =>
        vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => Response.json(body));

    it('posts credentialed, uncached JSON to the Better Auth two-factor endpoints', async () => {
        const fetch = ok({ status: true });
        expect(await new TwoFactorClient(fetch).verifyTotp(' 123 456 ')).toEqual({ ok: true, value: undefined });
        expect(fetch).toHaveBeenCalledWith('/api/auth/two-factor/verify-totp', {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { accept: 'application/json', 'content-type': 'application/json' },
            body: JSON.stringify({ code: '123456' }),
        });
        const backup = ok();
        await new TwoFactorClient(backup).verifyBackupCode(' ABCDE-12345 ');
        expect(backup.mock.calls[0]?.[0]).toBe('/api/auth/two-factor/verify-backup-code');
        expect(JSON.parse(String(backup.mock.calls[0]?.[1]?.body))).toEqual({ code: 'ABCDE-12345' });
    });

    it('enables enrollment and returns the key and backup codes from that one response', async () => {
        const uri = 'otpauth://totp/Nestrum:a%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=Nestrum';
        const result = await new TwoFactorClient(ok({ totpURI: uri, backupCodes: ['aaaaa-bbbbb'] })).enable('pw');
        expect(result).toEqual({
            ok: true,
            value: { totpURI: uri, secret: 'JBSWY3DPEHPK3PXP', backupCodes: ['aaaaa-bbbbb'] },
        });
        const invalid = await new TwoFactorClient(
            ok({ totpURI: 'https://evil.example/?secret=x', backupCodes: [] }),
        ).enable('pw');
        expect(invalid).toMatchObject({ ok: false, message: expect.stringMatching(/Unable to complete/) });
    });

    it.each([
        [401, { code: 'INVALID_TWO_FACTOR_COOKIE', message: 'Private backend details' }, /sign-in expired/],
        [400, { code: 'INVALID_CODE' }, /not valid/],
        [401, { code: 'INVALID_BACKUP_CODE' }, /not valid/],
        [429, { code: 'ACCOUNT_TEMPORARILY_LOCKED' }, /Too many attempts/],
        [401, { code: 'INVALID_PASSWORD' }, /password is not correct/],
        [500, { message: 'stack trace' }, /Unable to complete/],
    ])('maps a %s response to a safe message', async (status, body, expected) => {
        const fetch = vi.fn(async () => Response.json(body, { status }));
        const result = await new TwoFactorClient(fetch).verifyTotp('123456');
        expect(result).toMatchObject({ ok: false, message: expect.stringMatching(expected) });
        expect(JSON.stringify(result)).not.toMatch(/Private backend|stack trace/);
    });

    it('survives network failure and reports sign-out success', async () => {
        const offline = vi.fn(async () => {
            throw new Error('offline');
        });
        expect(await new TwoFactorClient(offline).verifyTotp('123456')).toMatchObject({ ok: false });
        expect(await new TwoFactorClient(offline).signOut()).toBe(false);
        expect(await new TwoFactorClient(ok()).signOut()).toBe(true);
    });
});

describe('Framework-owned pages', () => {
    const pending = { status: 'two-factor', reason: 'challenge-required', message: '' };
    const signIn = { status: 'sign-in', message: '' };

    it('renders the code form for a pending sign-in and a sign-in-again prompt for a stale session', async () => {
        const form = await render(ChallengePage, {
            props: { data: { admin: signIn, path: '/admin/auth/2fa', next: '/admin/projects' } } as never,
        });
        expect(form.body).toContain('autocomplete="one-time-code"');
        expect(form.body).toContain('inputmode="numeric"');
        expect(form.body).toContain('href="/admin/auth/recovery?next=%2Fadmin%2Fprojects"');
        expect(form.body).not.toMatch(/<script/i);
        const stale = await render(ChallengePage, {
            props: { data: { admin: pending, path: '', next: '/admin/projects' } } as never,
        });
        expect(stale.body).toContain('Sign in again');
        expect(stale.body).not.toContain('one-time-code');
    });

    it('renders the recovery form', async () => {
        const output = await render(RecoveryPage, {
            props: { data: { admin: signIn, path: '', next: '/admin' } } as never,
        });
        expect(output.body).toContain('Recovery code');
        expect(output.body).toContain('autocomplete="off"');
        expect(output.body).toContain('href="/admin/auth/2fa"');
    });

    it('starts setup with a password confirmation and points signed-out or verified users elsewhere', async () => {
        const setup = { status: 'two-factor', reason: 'setup-required', message: '' };
        const begin = await render(SetupPage, { props: { data: { admin: setup, path: '', next: '/admin' } } as never });
        expect(begin.body).toContain('type="password"');
        expect(begin.body).toContain('Begin setup');
        expect(begin.body).not.toContain('Recovery codes');
        const out = await render(SetupPage, { props: { data: { admin: signIn, path: '', next: '/admin' } } as never });
        expect(out.body).toContain('href="/admin"');
        expect(out.body).not.toContain('type="password"');
        const ready = await render(SetupPage, {
            props: { data: { admin: { status: 'ready', resources: [] }, path: '', next: '/admin/x' } } as never,
        });
        expect(ready.body).toContain('active for this session');
    });
});
