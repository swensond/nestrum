import type { Authentication } from '@nestrum/core';
import { defineApplication } from '@nestrum/core';
import { createHonoRuntime } from '@nestrum/hono';
import { describe, expect, it } from 'vitest';
import { defineAuth } from '../src/index.js';
import { storage } from './fixtures.js';

const BASE_URL = 'http://localhost:3000';
const SECRET = 'nestrum-test-secret-longer-than-thirty-two-characters';
const PASSWORD = 'a-valid-password-123';

function post(path: string, body: object, cookie?: string) {
    return new Request(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE_URL, ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
    });
}
const cookieOf = (response: Response) =>
    response.headers
        .getSetCookie()
        .filter((value) => !/=;|Max-Age=0/i.test(value))
        .map((value) => value.split(';')[0])
        .join('; ');
const withCookie = (cookie: string) => new Request(`${BASE_URL}/`, { headers: { cookie } });

async function setup() {
    const memory = storage();
    const application = defineApplication({
        apps: [],
        databases: {
            default: { kind: 'prisma', provider: 'postgresql', connection: 'unused' },
            identity: { kind: 'prisma', provider: 'postgresql', connection: 'unused' },
        },
        auth: defineAuth({ database: 'identity', baseURL: BASE_URL, secret: SECRET, prisma: () => memory.binding }),
    });
    const runtime = createHonoRuntime({ application, onError: () => {} });
    await runtime.start();
    const auth = application.auth as Authentication;
    const call = (request: Request) => runtime.fetch(request);
    const signUp = async (email: string) => {
        const response = await call(post('/api/auth/sign-up/email', { name: email, email, password: PASSWORD }));
        expect(response.status).toBe(200);

        return { cookie: cookieOf(response), id: ((await response.json()) as { user: { id: string } }).user.id };
    };
    const signIn = async (email: string, password = PASSWORD) =>
        cookieOf(await call(post('/api/auth/sign-in/email', { email, password })));

    return { auth, call, memory, signUp, signIn, application };
}

describe('Roles and user management', () => {
    it('maps the role into the subject and gives new users the user role', async () => {
        const { auth, signUp, memory } = await setup();
        const { cookie } = await signUp('a@example.test');
        expect(memory.records.User?.[0]?.role).toBe('user');
        expect(await auth.resolveSubject(withCookie(cookie))).toMatchObject({ anonymous: false, role: 'user' });
    });

    it('cannot be given a role through public sign-up', async () => {
        const { call, memory } = await setup();
        const response = await call(
            post('/api/auth/sign-up/email', { name: 'E', email: 'e@example.test', password: PASSWORD, role: 'admin' }),
        );
        // Better Auth rejects the non-input field outright; nothing is created.
        expect(response.status).toBe(400);
        expect(memory.records.User).toHaveLength(0);
    });

    it('creates an administrator with a working password, and refuses duplicates unless promoting', async () => {
        const { auth, signIn, signUp, memory } = await setup();
        const created = await auth.createAdministrator({
            email: ' Root@Example.test ',
            name: 'Root',
            password: PASSWORD,
        });
        expect(created).toMatchObject({ created: true, user: { email: 'root@example.test', role: 'admin' } });
        expect(memory.records.User?.[0]?.emailVerified).toBe(true);
        expect(memory.records.Account?.[0]?.password).not.toBe(PASSWORD);
        const cookie = await signIn('root@example.test');
        expect(await auth.resolveSubject(withCookie(cookie))).toMatchObject({ role: 'admin' });

        await expect(
            auth.createAdministrator({ email: 'root@example.test', name: 'Root', password: PASSWORD }),
        ).rejects.toMatchObject({ code: 'AUTH_ADMINISTRATOR_EXISTS', status: 409 });
        await signUp('member@example.test');
        const promoted = await auth.createAdministrator({
            email: 'member@example.test',
            name: 'x',
            password: 'ignored',
            promoteExisting: true,
        });
        expect(promoted).toMatchObject({ created: false, user: { role: 'admin' } });
    });

    it.each([
        [{ email: 'not-an-email', name: 'A', password: PASSWORD }],
        [{ email: 'a@example.test', name: '  ', password: PASSWORD }],
        [{ email: 'a@example.test', name: 'A', password: 'short' }],
    ])('rejects an invalid administrator %j', async (input) => {
        const { auth, memory } = await setup();
        await expect(auth.createAdministrator(input)).rejects.toMatchObject({ code: 'AUTH_ADMINISTRATOR_INVALID' });
        expect(memory.records.User).toHaveLength(0);
    });

    it('lets an administrator list, search and re-role users, and nobody else', async () => {
        const { auth, signIn, signUp } = await setup();
        await auth.createAdministrator({ email: 'root@example.test', name: 'Root', password: PASSWORD });
        const admin = withCookie(await signIn('root@example.test'));
        const alice = await signUp('alice@example.test');
        await signUp('bob@example.test');

        const page = await auth.users.list(admin, { limit: 10, offset: 0 });
        expect(page.total).toBe(3);
        expect(page.users.map((user) => user.email).sort()).toEqual([
            'alice@example.test',
            'bob@example.test',
            'root@example.test',
        ]);
        const found = await auth.users.list(admin, { email: ' Alice@Example.test ', limit: 10, offset: 0 });
        expect(found.users.map((user) => user.email)).toEqual(['alice@example.test']);
        expect((await auth.users.list(admin, { limit: 1, offset: 1 })).users).toHaveLength(1);

        const staff = await auth.users.setRole(admin, { userId: alice.id, role: 'staff' });
        expect(staff).toMatchObject({ email: 'alice@example.test', role: 'staff' });
        expect(await auth.resolveSubject(withCookie(alice.cookie))).toMatchObject({ role: 'staff' });
        expect(await auth.users.setRole(admin, { userId: alice.id, role: 'user' })).toMatchObject({ role: 'user' });
        await auth.users.setRole(admin, { userId: alice.id, role: 'staff' });

        // Staff and ordinary users hold no user-management permission.
        await expect(auth.users.list(withCookie(alice.cookie), { limit: 10, offset: 0 })).rejects.toMatchObject({
            status: 403,
        });
        const bob = withCookie(await signIn('bob@example.test'));
        await expect(auth.users.list(bob, { limit: 10, offset: 0 })).rejects.toMatchObject({ status: 403 });
        await expect(auth.users.setRole(bob, { userId: alice.id, role: 'user' })).rejects.toMatchObject({
            status: 403,
        });
        await expect(auth.users.list(new Request(BASE_URL), { limit: 10, offset: 0 })).rejects.toMatchObject({
            status: 401,
        });
    });

    it('never lets the interface change an administrator or assign a role outside user and staff', async () => {
        const { auth, signIn, signUp } = await setup();
        const root = await auth.createAdministrator({ email: 'root@example.test', name: 'Root', password: PASSWORD });
        const admin = withCookie(await signIn('root@example.test'));
        await expect(auth.users.setRole(admin, { userId: root.user.id, role: 'user' })).rejects.toMatchObject({
            code: 'AUTH_ADMIN_ROLE_PROTECTED',
            status: 403,
        });
        const member = await signUp('m@example.test');
        await expect(auth.users.setRole(admin, { userId: member.id, role: 'admin' as never })).rejects.toBeDefined();
        await expect(auth.users.setRole(admin, { userId: 'missing', role: 'staff' })).rejects.toMatchObject({
            status: 404,
        });
    });

    it('does not forward Better Auth admin-plugin endpoints over HTTP', async () => {
        const { auth, call, signIn } = await setup();
        await auth.createAdministrator({ email: 'root@example.test', name: 'Root', password: PASSWORD });
        const cookie = await signIn('root@example.test');
        for (const path of ['/api/auth/admin/set-role', '/api/auth/admin/create-user', '/api/auth/admin/ban-user']) {
            expect((await call(post(path, { userId: 'x', role: 'admin' }, cookie))).status).toBe(404);
        }
        expect((await call(new Request(`${BASE_URL}/api/auth/admin/list-users`, { headers: { cookie } }))).status).toBe(
            404,
        );
    });
});
