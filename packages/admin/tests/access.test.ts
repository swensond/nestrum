import { defineAuth, totpCode, totpSecretFromUri, totpStep } from '@nestrum/auth';
import { defineApplication } from '@nestrum/core';
import { createHonoRuntime } from '@nestrum/hono';
import { describe, expect, it } from 'vitest';
import { storage } from '../../auth/tests/fixtures.js';
import { defineAdmin, roleBasedAdminPolicies } from '../src/index.js';

const BASE_URL = 'http://localhost:3000';
const PASSWORD = 'a-valid-password-123';

function json(method: string, value?: unknown, cookie?: string): RequestInit {
    return {
        method,
        headers: {
            ...(value === undefined ? {} : { 'content-type': 'application/json' }),
            origin: BASE_URL,
            ...(cookie ? { cookie } : {}),
        },
        ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    };
}
const cookieOf = (response: Response) =>
    response.headers
        .getSetCookie()
        .filter((value) => !/=;|Max-Age=0/i.test(value))
        .map((value) => value.split(';')[0])
        .join('; ');

async function setup() {
    const memory = storage();
    const application = defineApplication({
        apps: [],
        database: { kind: 'prisma', provider: 'postgresql', connection: 'unused' },
        auth: defineAuth({
            baseURL: BASE_URL,
            secret: 'nestrum-admin-test-secret-longer-than-thirty-two-characters',
            prisma: () => memory.binding,
        }),
        admin: defineAdmin(),
        policies: roleBasedAdminPolicies(),
    });
    const runtime = createHonoRuntime({ application, onError: () => {} });
    await runtime.start();
    const call = (path: string, init?: RequestInit) => runtime.fetch(new Request(`${BASE_URL}${path}`, init));
    const get = (path: string, cookie: string) => call(path, { headers: { cookie } });
    async function enroll(cookie: string) {
        const enabled = await call('/api/auth/two-factor/enable', json('POST', { password: PASSWORD }, cookie));
        const { totpURI } = (await enabled.json()) as { totpURI: string };
        const secret = totpSecretFromUri(totpURI);
        const verified = await call(
            '/api/auth/two-factor/verify-totp',
            json('POST', { code: totpCode(secret, totpStep(Date.now())) }, cookie),
        );
        expect(verified.status).toBe(200);

        return { cookie: cookieOf(verified), secret };
    }
    async function signInWithTotp(email: string, secret: string) {
        const login = await call('/api/auth/sign-in/email', json('POST', { email, password: PASSWORD }));
        const verified = await call(
            '/api/auth/two-factor/verify-totp',
            json('POST', { code: totpCode(secret, totpStep(Date.now())) }, cookieOf(login)),
        );
        expect(verified.status).toBe(200);

        return cookieOf(verified);
    }
    async function administrator() {
        await application.auth?.createAdministrator({ email: 'root@example.test', name: 'Root', password: PASSWORD });
        const login = await call(
            '/api/auth/sign-in/email',
            json('POST', { email: 'root@example.test', password: PASSWORD }),
        );

        return enroll(cookieOf(login));
    }
    async function member(email: string) {
        const response = await call(
            '/api/auth/sign-up/email',
            json('POST', { name: email, email, password: PASSWORD }),
        );

        return { cookie: cookieOf(response), id: ((await response.json()) as { user: { id: string } }).user.id };
    }

    return { call, get, enroll, signInWithTotp, administrator, member, application };
}

describe('Staff management API', () => {
    it('is denied to anonymous requests, users, and administrators without a second factor', async () => {
        const { call, get, member, application } = await setup();
        expect((await call('/__admin/access/users')).status).toBe(401);
        const user = await member('user@example.test');
        const denied = await get('/__admin/access/users', user.cookie);
        expect(denied.status).toBe(403);
        expect(await denied.json()).toMatchObject({ error: { reason: 'NOT_STAFF' } });
        // An administrator who has not set up 2FA is stopped by the same boundary as everything else.
        await application.auth?.createAdministrator({ email: 'root@example.test', name: 'Root', password: PASSWORD });
        const login = await call(
            '/api/auth/sign-in/email',
            json('POST', { email: 'root@example.test', password: PASSWORD }),
        );
        const stopped = await get('/__admin/access/users', cookieOf(login));
        expect(stopped.status).toBe(403);
        expect(await stopped.json()).toMatchObject({ error: { code: 'ADMIN_2FA_REQUIRED', reason: 'setup-required' } });
    });

    it('lets an administrator list users and promote one to staff, who then enters admin but cannot manage users', async () => {
        const { call, get, administrator, member, enroll, signInWithTotp } = await setup();
        const admin = await administrator();
        const alice = await member('alice@example.test');
        await member('bob@example.test');

        const capabilities = await get('/__admin/access/capabilities', admin.cookie);
        expect(await capabilities.json()).toEqual({ users: true });
        const list = await get('/__admin/access/users?limit=2', admin.cookie);
        expect(list.headers.get('cache-control')).toBe('no-store');
        expect(await list.json()).toMatchObject({ total: 3, limit: 2, offset: 0 });
        const filtered = await get('/__admin/access/users?email=Alice@example.test', admin.cookie);
        expect(((await filtered.json()) as { users: { email: string }[] }).users.map((user) => user.email)).toEqual([
            'alice@example.test',
        ]);

        // Ordinary users cannot enter admin at all, so alice needs the staff role first.
        expect((await get('/__admin/resources', alice.cookie)).status).toBe(403);
        const promoted = await call(
            `/__admin/access/users/${alice.id}/role`,
            json('POST', { role: 'staff' }, admin.cookie),
        );
        expect(promoted.status).toBe(200);
        expect(await promoted.json()).toMatchObject({ user: { email: 'alice@example.test', role: 'staff' } });

        // Promotion updates the user, so her older session must be re-established; she then enrolls 2FA.
        const relogin = await call(
            '/api/auth/sign-in/email',
            json('POST', { email: 'alice@example.test', password: PASSWORD }),
        );
        const enrolled = await enroll(cookieOf(relogin));
        expect((await get('/__admin/resources', enrolled.cookie)).status).toBe(200);
        expect(await (await get('/__admin/access/capabilities', enrolled.cookie)).json()).toEqual({ users: false });
        const forbidden = await get('/__admin/access/users', enrolled.cookie);
        expect(forbidden.status).toBe(403);
        expect(await forbidden.json()).toMatchObject({ error: { reason: 'USER_MANAGEMENT_DENIED' } });
        expect(
            (await call(`/__admin/access/users/${alice.id}/role`, json('POST', { role: 'user' }, enrolled.cookie)))
                .status,
        ).toBe(403);

        // Demotion removes admin access again, including for a fully verified sign-in.
        expect(
            (await call(`/__admin/access/users/${alice.id}/role`, json('POST', { role: 'user' }, admin.cookie))).status,
        ).toBe(200);
        const again = await signInWithTotp('alice@example.test', enrolled.secret);
        const revoked = await get('/__admin/resources', again);
        expect(revoked.status).toBe(403);
        expect(await revoked.json()).toMatchObject({ error: { reason: 'NOT_STAFF' } });
    });

    it('never modifies administrators and rejects bad input', async () => {
        const { call, get, administrator, member } = await setup();
        const admin = await administrator();
        const list = (await (await get('/__admin/access/users', admin.cookie)).json()) as { users: { id: string }[] };
        const rootId = list.users[0]?.id;
        const protectedRoot = await call(
            `/__admin/access/users/${rootId}/role`,
            json('POST', { role: 'user' }, admin.cookie),
        );
        expect(protectedRoot.status).toBe(403);
        expect(await protectedRoot.json()).toMatchObject({ error: { code: 'AUTH_ADMIN_ROLE_PROTECTED' } });

        const target = await member('t@example.test');
        for (const body of [{ role: 'admin' }, { role: 'staff', extra: 1 }, {}, { role: ['staff'] }]) {
            const bad = await call(`/__admin/access/users/${target.id}/role`, json('POST', body, admin.cookie));
            expect(bad.status, JSON.stringify(body)).toBe(400);
        }
        for (const query of ['limit=0', 'limit=101', 'offset=-1', 'unknown=1', 'limit=abc']) {
            expect((await get(`/__admin/access/users?${query}`, admin.cookie)).status, query).toBe(400);
        }
        expect(
            (await call('/__admin/access/users/missing/role', json('POST', { role: 'staff' }, admin.cookie))).status,
        ).toBe(404);
        expect(
            (
                await call(`/__admin/access/users/${target.id}/role`, {
                    method: 'POST',
                    headers: { cookie: admin.cookie, origin: BASE_URL, 'content-type': 'text/plain' },
                    body: 'staff',
                })
            ).status,
        ).toBe(415);
    });

    it('keeps same-origin enforcement in front of role changes', async () => {
        const { call, administrator, member } = await setup();
        const admin = await administrator();
        const target = await member('t@example.test');
        const cross = await call(`/__admin/access/users/${target.id}/role`, {
            method: 'POST',
            headers: {
                cookie: admin.cookie,
                origin: 'https://evil.example',
                'content-type': 'application/json',
            },
            body: JSON.stringify({ role: 'staff' }),
        });
        expect(cross.status).toBe(403);
        expect(await cross.json()).toMatchObject({ error: { code: 'ADMIN_ORIGIN_DENIED' } });
    });

    it('fails closed when the application defines no admin.users policy', async () => {
        const memory = storage();
        const application = defineApplication({
            apps: [],
            database: { kind: 'prisma', provider: 'postgresql', connection: 'unused' },
            auth: defineAuth({
                baseURL: BASE_URL,
                secret: 'nestrum-admin-test-secret-longer-than-thirty-two-characters',
                prisma: () => memory.binding,
            }),
            admin: defineAdmin({ security: { twoFactor: { required: false } } }),
            policies: roleBasedAdminPolicies().filter((policy) => policy.resource === 'admin.access'),
        });
        const runtime = createHonoRuntime({ application, onError: () => {} });
        await runtime.start();
        await application.auth?.createAdministrator({ email: 'root@example.test', name: 'Root', password: PASSWORD });
        const login = await runtime.fetch(
            new Request(
                `${BASE_URL}/api/auth/sign-in/email`,
                json('POST', { email: 'root@example.test', password: PASSWORD }),
            ),
        );
        const response = await runtime.fetch(
            new Request(`${BASE_URL}/__admin/access/users`, { headers: { cookie: cookieOf(login) } }),
        );
        expect(response.status).toBe(403);
    });
});
