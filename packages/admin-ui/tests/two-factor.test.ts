import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import { AdminMetadataClient, loadAdminState } from '../src/lib/metadata.js';
import { isAuthPath, safeReturnTo, twoFactorHref, withNext } from '../src/lib/return-to.js';
import { confirmEnrollment, startEnrollment, submitChallenge, TwoFactorClient } from '../src/lib/two-factor.server.js';
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

describe('Two-factor form handling', () => {
    it('posts a challenge as credentialed, uncached JSON and returns to the intended route', async () => {
        const fetch = vi.fn(async () => Response.json({ assurance: { level: 'two-factor' } }));
        const result = await redirected(
            submitChallenge({ fetch, request: form({ code: ' 123456 ', next: '/admin/projects?limit=50' }) }, 'totp'),
        );
        expect(result).toMatchObject({ status: 303, location: '/admin/projects?limit=50' });
        expect(fetch).toHaveBeenCalledWith('/__admin/auth/2fa/challenge', {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { accept: 'application/json', 'content-type': 'application/json' },
            body: JSON.stringify({ code: '123456' }),
        });
    });

    it('uses the recovery endpoint for recovery codes and never redirects to an unsafe target', async () => {
        const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
            Response.json({ assurance: {} }),
        );
        const result = await redirected(
            submitChallenge(
                { fetch, request: form({ code: 'ABCD-EFGH-JKLM', next: 'https://evil.example' }) },
                'recovery',
            ),
        );
        expect(result).toMatchObject({ location: '/admin' });
        expect(fetch.mock.calls[0]?.[0]).toBe('/__admin/auth/2fa/recovery/verify');
    });

    it.each([
        [400, { error: { code: 'TWO_FACTOR_INVALID_CODE', message: 'Private backend details' } }, /not valid/],
        [429, { error: { code: 'TWO_FACTOR_LOCKED' } }, /Too many attempts/],
        [401, { error: { code: 'ADMIN_AUTHENTICATION_REQUIRED' } }, /expired/],
        [500, { error: { code: 'INTERNAL_SERVER_ERROR', message: 'stack trace' } }, /Unable to complete/],
    ])('maps a %s backend response to a safe message', async (status, body, expected) => {
        const fetch = vi.fn(async () => Response.json(body, { status }));
        const result = (await submitChallenge(
            { fetch, request: form({ code: '123456', next: '/admin/x' }) },
            'totp',
        )) as {
            status: number;
            data: { message: string; next: string };
        };
        expect(result.status).toBe(status);
        expect(result.data.message).toMatch(expected);
        expect(JSON.stringify(result.data)).not.toMatch(/Private backend|stack trace/);
        expect(result.data.next).toBe('/admin/x');
    });

    it('survives network failure and rejects malformed forms before calling the API', async () => {
        const failing = vi.fn(async () => {
            throw new Error('offline');
        });
        expect(
            (
                (await submitChallenge({ fetch: failing, request: form({ code: '123456' }) }, 'totp')) as {
                    status: number;
                }
            ).status,
        ).toBe(503);
        const fetch = vi.fn();
        for (const request of [
            form({}),
            form({ code: '   ' }),
            form({ code: ['1', '2'] }),
            form({ code: '123456', admin: 'true' }),
            form({ code: 'x'.repeat(65) }),
        ]) {
            expect(((await submitChallenge({ fetch, request }, 'totp')) as { status: number }).status).toBe(400);
        }
        expect(fetch).not.toHaveBeenCalled();
    });

    it('starts enrollment and returns the key only in that action result', async () => {
        const fetch = vi.fn(async () =>
            Response.json(
                { secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/Nestrum:a?secret=JBSWY3DPEHPK3PXP' },
                { status: 201 },
            ),
        );
        expect(await startEnrollment({ fetch, request: form({ next: '/admin/x' }) })).toEqual({
            step: 'confirm',
            next: '/admin/x',
            secret: 'JBSWY3DPEHPK3PXP',
            otpauthUri: 'otpauth://totp/Nestrum:a?secret=JBSWY3DPEHPK3PXP',
        });
        const invalid = vi.fn(async () => Response.json({ secret: 'x', otpauthUri: 'https://evil.example' }));
        expect(((await startEnrollment({ fetch: invalid, request: form({}) })) as { status: number }).status).toBe(502);
    });

    it('confirms enrollment with one-time recovery codes and lets a failed attempt retry', async () => {
        const codes = ['AAAA-BBBB-CCCC', 'DDDD-EEEE-FFFF'];
        const ok = vi.fn(async () => Response.json({ assurance: {}, recoveryCodes: codes }));
        expect(await confirmEnrollment({ fetch: ok, request: form({ code: '123456', next: '/admin/x' }) })).toEqual({
            step: 'done',
            next: '/admin/x',
            recoveryCodes: codes,
        });
        const bad = vi.fn(async () => Response.json({ error: { code: 'TWO_FACTOR_INVALID_CODE' } }, { status: 400 }));
        const result = (await confirmEnrollment({ fetch: bad, request: form({ code: '000000' }) })) as unknown as {
            status: number;
            data: { step: string; message: string };
        };
        expect(result.status).toBe(400);
        expect(result.data).toMatchObject({ step: 'retry', message: expect.stringMatching(/not valid/) });
    });

    it('exposes the client for direct use with no retained state', async () => {
        const fetch = vi.fn(async () => Response.json({}));
        await new TwoFactorClient(fetch).recover('ABCD');
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});

describe('Framework-owned pages', () => {
    const admin = { status: 'two-factor', reason: 'challenge-required', message: '' };

    it('renders an accessible challenge form with a recovery alternative and a safe next value', async () => {
        const output = await render(ChallengePage, {
            props: {
                data: { admin, path: '/admin/auth/2fa', next: '/admin/projects' },
                form: { message: 'That code is not valid.' },
            } as never,
        });
        expect(output.body).toContain('autocomplete="one-time-code"');
        expect(output.body).toContain('inputmode="numeric"');
        expect(output.body).toContain('role="alert"');
        expect(output.body).toContain('name="next" value="/admin/projects"');
        expect(output.body).toContain('href="/admin/auth/recovery?next=%2Fadmin%2Fprojects"');
        expect(output.body).not.toMatch(/<script/i);
    });

    it('renders the recovery form', async () => {
        const output = await render(RecoveryPage, {
            props: { data: { admin, path: '', next: '/admin' }, form: null } as never,
        });
        expect(output.body).toContain('Recovery code');
        expect(output.body).toContain('autocomplete="off"');
    });

    it('walks setup: begin, key display, activation form, then one-time recovery codes', async () => {
        const data = { admin: { ...admin, reason: 'setup-required' }, path: '', next: '/admin' };
        const begin = await render(SetupPage, { props: { data, form: null } as never });
        expect(begin.body).toContain('action="?/start"');
        const confirm = await render(SetupPage, {
            props: {
                data,
                form: {
                    step: 'confirm',
                    next: '/admin',
                    secret: 'JBSWY3DPEHPK3PXP',
                    otpauthUri: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP',
                },
            } as never,
        });
        expect(confirm.body).toContain('JBSWY3DPEHPK3PXP');
        expect(confirm.body).toContain('href="otpauth://totp/x?secret=JBSWY3DPEHPK3PXP"');
        expect(confirm.body).toContain('action="?/confirm"');
        const retry = await render(SetupPage, {
            props: { data, form: { step: 'retry', next: '/admin', message: 'That code is not valid.' } } as never,
        });
        expect(retry.body).toContain('action="?/start"');
        expect(retry.body).toContain('action="?/confirm"');
        expect(retry.body).not.toContain('Setup key');
        const done = await render(SetupPage, {
            props: {
                data: { ...data, admin: { status: 'ready', resources: [] } },
                form: { step: 'done', next: '/admin', recoveryCodes: ['AAAA-BBBB-CCCC'] },
            } as never,
        });
        expect(done.body).toContain('AAAA-BBBB-CCCC');
        expect(done.body).toContain('cannot be retrieved later');
        const later = await render(SetupPage, {
            props: { data: { ...data, admin: { status: 'ready', resources: [] } }, form: null } as never,
        });
        expect(later.body).not.toContain('AAAA-BBBB-CCCC');
        expect(later.body).toContain('active for this session');
    });
});
