import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import { AccessClient, changeRole, loadAccessData } from '../src/lib/access.server.js';
import { load as loadLayout } from '../src/routes/+layout.server.js';
import { load as loadAccess } from '../src/routes/access/+page.server.js';
import AccessPage from '../src/routes/access/+page.svelte';
import { resource } from './fixtures.js';
import ShellFixture from './ShellFixture.svelte';

const USERS = [
    {
        id: 'u1',
        name: 'Ada',
        email: 'ada@example.test',
        role: 'user',
        twoFactorEnabled: false,
        createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
        id: 'u2',
        name: 'Bo',
        email: 'bo@example.test',
        role: 'staff',
        twoFactorEnabled: true,
        createdAt: '2026-01-02T00:00:00.000Z',
    },
    {
        id: 'u3',
        name: 'Root',
        email: 'root@example.test',
        role: 'admin',
        twoFactorEnabled: true,
        createdAt: '2026-01-03T00:00:00.000Z',
    },
];
const page = (overrides: object = {}) => ({ users: USERS, total: 3, limit: 25, offset: 0, ...overrides });
const url = (path: string) => new URL(`http://localhost${path}`);
function form(values: Record<string, string | string[]>) {
    const data = new FormData();
    for (const [name, value] of Object.entries(values)) {
        for (const item of Array.isArray(value) ? value : [value]) {
            data.append(name, item);
        }
    }

    return new Request('http://localhost/admin/access?/role', { method: 'POST', body: data });
}
async function redirected(promise: Promise<unknown>) {
    try {
        await promise;
    } catch (error) {
        return error as { status: number; location: string };
    }
    throw new Error('Expected a redirect.');
}

describe('Access client', () => {
    it('requests users credentialed and uncached, with the page size and exact email filter', async () => {
        const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => Response.json(page()));
        expect((await new AccessClient(fetch).list({ offset: 25, email: 'ada@example.test' })).total).toBe(3);
        expect(fetch.mock.calls[0]?.[0]).toBe('/__admin/access/users?limit=25&offset=25&email=ada%40example.test');
        expect(fetch.mock.calls[0]?.[1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store' });
    });

    it('treats any capability failure or malformed answer as no access', async () => {
        expect(await new AccessClient(async () => Response.json({ users: true })).canManage()).toBe(true);
        expect(await new AccessClient(async () => Response.json({ users: 'yes' })).canManage()).toBe(false);
        expect(await new AccessClient(async () => Response.json({}, { status: 403 })).canManage()).toBe(false);
        expect(
            await new AccessClient(async () => {
                throw new Error('offline');
            }).canManage(),
        ).toBe(false);
    });

    it('rejects a malformed user page rather than rendering it', async () => {
        await expect(
            new AccessClient(async () => Response.json({ users: [{ id: 1 }], total: 1, limit: 25, offset: 0 })).list({
                offset: 0,
            }),
        ).rejects.toMatchObject({ status: 502 });
    });
});

describe('Access page load', () => {
    it('loads a page, clamps hostile input, and maps failures to safe messages', async () => {
        const fetch = vi.fn(async () => Response.json(page()));
        expect(await loadAccessData(fetch, url('/admin/access?offset=25&email=a@b.test'))).toMatchObject({
            page: { total: 3 },
            message: '',
            email: 'a@b.test',
            offset: 25,
        });
        for (const bad of ['?offset=-1', '?offset=abc', '?offset=99999', `?email=${'a'.repeat(300)}`]) {
            const result = await loadAccessData(fetch, url(`/admin/access${bad}`));
            expect(result.page, bad).toBeNull();
            expect(result.message).toMatch(/not valid/);
        }
        expect(fetch).toHaveBeenCalledTimes(1);
        const denied = await loadAccessData(
            async () =>
                Response.json(
                    { error: { code: 'AUTH_USER_MANAGEMENT_DENIED', message: 'Private details' } },
                    { status: 403 },
                ),
            url('/admin/access'),
        );
        expect(denied).toMatchObject({ page: null, message: expect.stringMatching(/permission/) });
        expect(JSON.stringify(denied)).not.toContain('Private details');
    });

    it('does not call the API for a session that is not ready', async () => {
        const fetch = vi.fn();
        const result = await loadAccess({
            parent: async () => ({ admin: { status: 'sign-in', message: '' } }),
            fetch,
            url: url('/admin/access'),
        } as never);
        expect(result).toMatchObject({ page: null });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('shows the layout link only when the API says the subject can manage users', async () => {
        const event = (users: boolean) =>
            ({
                fetch: vi.fn(async (input: string | URL | Request) =>
                    String(input).endsWith('/access/capabilities')
                        ? Response.json({ users })
                        : Response.json([resource()]),
                ),
                depends: vi.fn(),
                url: url('/admin'),
            }) as never;
        expect((await loadLayout(event(true))).canManageUsers).toBe(true);
        expect((await loadLayout(event(false))).canManageUsers).toBe(false);
    });
});

describe('Role change action', () => {
    it('posts exactly the requested role and returns to the same list position with a confirmation', async () => {
        const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
            Response.json({ user: USERS[0] }),
        );
        const result = await redirected(
            changeRole({ fetch, request: form({ userId: 'u 1', role: 'staff', back: '?email=a%40b.test&offset=25' }) }),
        );
        expect(result).toMatchObject({ status: 303 });
        expect(result.location).toBe('/admin/access?email=a%40b.test&offset=25&saved=staff');
        expect(fetch.mock.calls[0]?.[0]).toBe('/__admin/access/users/u%201/role');
        expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({ role: 'staff' });
        expect(fetch.mock.calls[0]?.[1]?.method).toBe('POST');
    });

    it('never follows an unsafe return position', async () => {
        const fetch = vi.fn(async () => Response.json({}));
        for (const back of ['https://evil.example/', '//evil.example', '?next=<script>', '/admin/x']) {
            const result = await redirected(changeRole({ fetch, request: form({ userId: 'u1', role: 'user', back }) }));
            expect(result.location, back).toBe('/admin/access?saved=user');
        }
    });

    it.each([
        [{ userId: 'u1', role: 'admin' }],
        [{ userId: 'u1', role: ['user', 'staff'] }],
        [{ userId: ['u1', 'u2'], role: 'staff' }],
        [{ role: 'staff' }],
        [{ userId: 'x'.repeat(129), role: 'staff' }],
        [{ userId: 'u1', role: 'staff', extra: 'x' }],
    ])('rejects malformed form %j before calling the API', async (values) => {
        const fetch = vi.fn();
        const result = (await changeRole({ fetch, request: form(values) })) as unknown as { status: number };
        expect(result.status).toBe(400);
        expect(fetch).not.toHaveBeenCalled();
    });

    it.each([
        [403, { error: { code: 'AUTH_ADMIN_ROLE_PROTECTED' } }, /command line/],
        [403, { error: { code: 'USER_MANAGEMENT_DENIED' } }, /permission/],
        [404, {}, /no longer exists/],
        [500, { error: { code: 'X', message: 'stack trace' } }, /Unable to complete/],
    ])('maps a %s response to a safe message', async (status, body, expected) => {
        const fetch = vi.fn(async () => Response.json(body, { status }));
        const result = (await changeRole({ fetch, request: form({ userId: 'u1', role: 'staff' }) })) as unknown as {
            status: number;
            data: { message: string };
        };
        expect(result.status).toBe(status);
        expect(result.data.message).toMatch(expected);
        expect(JSON.stringify(result.data)).not.toContain('stack trace');
    });
});

describe('Access page rendering', () => {
    const base = { admin: { status: 'ready', resources: [] }, path: '/admin/access', canManageUsers: true };

    it('renders native forms per row, with administrators read-only', async () => {
        const output = await render(AccessPage, {
            props: {
                data: { ...base, page: page(), message: '', email: '', offset: 0, saved: '' },
                form: null,
            } as never,
        });
        expect(output.body).toContain('Make staff');
        expect(output.body).toContain('Remove staff access');
        expect(output.body).toContain('name="role" value="staff"');
        expect(output.body).toContain('name="role" value="user"');
        expect(output.body).toContain('action="?/role"');
        expect(output.body).toContain('Administrator');
        expect(output.body.match(/name="userId"/g)).toHaveLength(2);
        expect(output.body).not.toMatch(/<script/i);
    });

    it('escapes user-controlled values, paginates, and reports feedback', async () => {
        const hostile = [{ ...USERS[0], id: 'u9', name: '<img src=x onerror=alert(1)>', email: 'x@example.test' }];
        const output = await render(AccessPage, {
            props: {
                data: {
                    ...base,
                    page: page({ users: hostile, total: 60, offset: 25 }),
                    message: '',
                    email: 'x@example.test',
                    offset: 25,
                    saved: 'staff',
                },
                form: { message: 'That user no longer exists.' },
            } as never,
        });
        expect(output.body).not.toContain('<img src=x');
        expect(output.body).toContain('&lt;img');
        expect(output.body).toContain('href="?email=x%40example.test&amp;offset=0"');
        expect(output.body).toContain('href="?email=x%40example.test&amp;offset=50"');
        expect(output.body).toContain('26–26 of 60');
        expect(output.body).toContain('User is now staff.');
        expect(output.body).toContain('no longer exists');
    });

    it('shows a load failure without a table', async () => {
        const output = await render(AccessPage, {
            props: {
                data: {
                    ...base,
                    page: null,
                    message: 'You do not have permission to manage users.',
                    email: '',
                    offset: 0,
                    saved: '',
                },
                form: null,
            } as never,
        });
        expect(output.body).toContain('permission');
        expect(output.body).not.toContain('<table');
    });

    it('adds the shell link only when allowed', async () => {
        const state = { status: 'ready', resources: [resource()] } as const;
        const allowed = await render(ShellFixture, { props: { state, canManageUsers: true } });
        expect(allowed.body).toContain('href="/admin/access"');
        const hidden = await render(ShellFixture, { props: { state } });
        expect(hidden.body).not.toContain('/admin/access');
    });
});
