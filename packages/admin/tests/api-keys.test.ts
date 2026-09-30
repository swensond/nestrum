import { defineAuth, totpCode, totpSecretFromUri, totpStep } from '@nestrum/auth';
import type { PolicyDefinition, QuerySpec } from '@nestrum/core';
import { allow, defineApplication, defineResource, eq } from '@nestrum/core';
import { createHonoRuntime } from '@nestrum/hono';
import { generateModelSchemas } from '@nestrum/zod';
import { describe, expect, it, vi } from 'vitest';
import { storage } from '../../auth/tests/fixtures.js';
import { defineAdmin, roleBasedAdminPolicies } from '../src/index.js';

const BASE_URL = 'http://localhost:3000';
const PASSWORD = 'a-valid-password-123';
const FIELD = {
    codec: 'pg/text@1',
    nullable: false,
    optional: false,
    array: false,
    hasCreateDefault: false,
    hasUpdateDefault: false,
} as const;
const METADATA = {
    database: 'default',
    name: 'Project',
    identity: 'default.Project',
    provider: 'postgresql',
    namespace: 'public',
    relations: [],
    fields: [
        { ...FIELD, name: 'id', kind: 'integer', codec: 'pg/int4@1', primaryKey: true, hasCreateDefault: true },
        { ...FIELD, name: 'name', kind: 'string', primaryKey: false },
        { ...FIELD, name: 'ownerId', kind: 'string', primaryKey: false },
    ],
} as const;

function json(method: string, value?: unknown, cookie?: string, origin = BASE_URL): RequestInit {
    return {
        method,
        headers: {
            ...(value === undefined ? {} : { 'content-type': 'application/json' }),
            origin,
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

async function setup(policies: PolicyDefinition[] = roleBasedAdminPolicies()) {
    const memory = storage();
    const backend = {
        raw: {},
        all: vi.fn(
            async (_query: QuerySpec): Promise<Record<string, unknown>[]> => [
                { id: 1, name: 'One', ownerId: 'someone' },
            ],
        ),
        count: vi.fn(async () => 1),
        create: vi.fn(async (data: object) => ({ id: 2, ...data })),
        update: vi.fn(async () => 1),
        delete: vi.fn(async () => 1),
    };
    const application = defineApplication({
        apps: [],
        databases: {
            default: { kind: 'prisma', provider: 'postgresql', connection: 'unused' },
            identity: { kind: 'prisma', provider: 'postgresql', connection: 'unused' },
        },
        auth: defineAuth({
            database: 'identity',
            baseURL: BASE_URL,
            secret: 'nestrum-admin-test-secret-longer-than-thirty-two-characters',
            prisma: () => memory.binding,
        }),
        admin: defineAdmin(),
        resources: [
            defineResource({
                model: 'Project',
                api: {
                    list: true,
                    retrieve: true,
                    create: true,
                    auth: ['api-key'],
                    scopes: { create: 'projects:create' },
                },
            }),
        ],
        resourceModels: [{ ...generateModelSchemas(METADATA as never), queryBackend: backend }],
        policies: [
            ...policies,
            {
                resource: 'default.Project',
                actions: {
                    read: { scope: ({ subject }) => eq('ownerId', (subject.owner as { id: string }).id) },
                    create: { authorize: () => allow() },
                },
            },
        ],
    });
    const runtime = createHonoRuntime({ application, onError: () => {} });
    await runtime.start();
    const call = (path: string, init?: RequestInit) => runtime.fetch(new Request(`${BASE_URL}${path}`, init));
    const get = (path: string, cookie: string) => call(path, { headers: { cookie } });
    async function enroll(cookie: string) {
        const enabled = await call('/api/auth/two-factor/enable', json('POST', { password: PASSWORD }, cookie));
        const secret = totpSecretFromUri(((await enabled.json()) as { totpURI: string }).totpURI);
        const verified = await call(
            '/api/auth/two-factor/verify-totp',
            json('POST', { code: totpCode(secret, totpStep(Date.now())) }, cookie),
        );
        expect(verified.status).toBe(200);

        return cookieOf(verified);
    }
    async function member(email: string, role?: 'staff') {
        const response = await call(
            '/api/auth/sign-up/email',
            json('POST', { name: email, email, password: PASSWORD }),
        );
        const id = ((await response.json()) as { user: { id: string } }).user.id;
        if (role) {
            const user = memory.records.User.find((row) => row.id === id);
            if (user) {
                user.role = role;
            }
        }

        return { cookie: cookieOf(response), id };
    }
    async function administrator() {
        await application.auth?.createAdministrator({ email: 'root@example.test', name: 'Root', password: PASSWORD });
        const login = await call(
            '/api/auth/sign-in/email',
            json('POST', { email: 'root@example.test', password: PASSWORD }),
        );

        return enroll(cookieOf(login));
    }
    const create = (cookie: string, body: unknown) => call('/__admin/api-keys', json('POST', body, cookie));

    return { call, get, create, enroll, member, administrator, application, memory, backend };
}

describe('Admin API-key management', () => {
    it('is denied to anonymous requests, users, unenrolled administrators and staff', async () => {
        const { call, get, create, member, enroll, application } = await setup();
        expect((await call('/__admin/api-keys')).status).toBe(401);
        expect((await create('', { name: 'k', ownerId: 'x', scopes: [] })).status).toBe(401);
        const user = await member('user@example.test');
        const denied = await get('/__admin/api-keys', user.cookie);
        expect(denied.status).toBe(403);
        expect(await denied.json()).toMatchObject({ error: { reason: 'NOT_STAFF' } });
        // Administrators without a second factor are stopped by the admin 2FA boundary.
        await application.auth?.createAdministrator({ email: 'root@example.test', name: 'Root', password: PASSWORD });
        const login = await call(
            '/api/auth/sign-in/email',
            json('POST', { email: 'root@example.test', password: PASSWORD }),
        );
        const stopped = await get('/__admin/api-keys', cookieOf(login));
        expect(stopped.status).toBe(403);
        expect(await stopped.json()).toMatchObject({ error: { code: 'ADMIN_2FA_REQUIRED', reason: 'setup-required' } });
        expect((await create(cookieOf(login), { name: 'k', ownerId: user.id, scopes: [] })).status).toBe(403);
        // Staff may use administration but not manage API keys.
        const staff = await member('staff@example.test', 'staff');
        const staffCookie = await enroll(staff.cookie);
        expect((await get('/__admin/resources', staffCookie)).status).toBe(200);
        expect(await (await get('/__admin/api-keys/capabilities', staffCookie)).json()).toEqual({
            read: false,
            create: false,
            revoke: false,
            rotate: false,
        });
        for (const response of [
            await get('/__admin/api-keys', staffCookie),
            await create(staffCookie, { name: 'k', ownerId: user.id, scopes: [] }),
            await call('/__admin/api-keys/x/revoke', json('POST', undefined, staffCookie)),
            await call('/__admin/api-keys/x/rotate', json('POST', undefined, staffCookie)),
        ]) {
            expect(response.status).toBe(403);
            expect(await response.json()).toMatchObject({
                error: { code: 'AUTHORIZATION_DENIED', reason: 'API_KEY_MANAGEMENT_DENIED' },
            });
        }
    });

    it('creates, lists, revokes and rotates keys, revealing each secret exactly once', async () => {
        const { call, get, create, member, administrator, memory } = await setup();
        const admin = await administrator();
        const owner = await member('owner@example.test');
        expect(await (await get('/__admin/api-keys/capabilities', admin)).json()).toEqual({
            read: true,
            create: true,
            revoke: true,
            rotate: true,
        });

        const created = await create(admin, {
            name: 'Billing sync',
            ownerId: owner.id,
            scopes: ['projects:read', 'projects:create'],
            expiresInDays: 30,
            metadata: { team: 'billing' },
            rateLimit: { requests: 100, windowSeconds: 10 },
        });
        expect(created.status).toBe(201);
        expect(created.headers.get('cache-control')).toBe('no-store');
        const { key, secret } = (await created.json()) as { key: { id: string; start: string }; secret: string };
        expect(secret).toMatch(/^nes_live_/);
        expect(key).toMatchObject({
            name: 'Billing sync',
            owner: { type: 'user', id: owner.id },
            scopes: ['projects:create', 'projects:read'],
            status: 'active',
            metadata: { team: 'billing' },
            rateLimit: { enabled: true, requests: 100, windowSeconds: 10 },
        });
        expect(JSON.stringify(memory.records)).not.toContain(secret);

        const list = await get('/__admin/api-keys', admin);
        expect(list.headers.get('cache-control')).toBe('no-store');
        const listed = await list.text();
        expect(listed).not.toContain(secret);
        expect(JSON.parse(listed)).toMatchObject({ total: 1, keys: [{ id: key.id, start: key.start }] });
        expect(
            ((await (await get(`/__admin/api-keys?ownerId=${owner.id}`, admin)).json()) as { total: number }).total,
        ).toBe(1);
        expect(((await (await get('/__admin/api-keys?ownerId=other', admin)).json()) as { total: number }).total).toBe(
            0,
        );

        const rotated = await call(`/__admin/api-keys/${key.id}/rotate`, json('POST', undefined, admin));
        expect(rotated.status).toBe(200);
        expect(rotated.headers.get('cache-control')).toBe('no-store');
        const next = (await rotated.json()) as {
            key: { id: string; status: string };
            secret: string;
            revoked: { id: string; status: string };
        };
        expect(next.secret).not.toBe(secret);
        expect(next.revoked).toMatchObject({ id: key.id, status: 'revoked' });
        const afterRotate = (await (await get('/__admin/api-keys', admin)).json()) as {
            keys: { id: string; status: string }[];
        };
        expect(afterRotate.keys.map((entry) => [entry.id, entry.status]).sort()).toEqual(
            [
                [key.id, 'revoked'],
                [next.key.id, 'active'],
            ].sort(),
        );
        expect(JSON.stringify(afterRotate)).not.toContain(next.secret);

        const revoked = await call(`/__admin/api-keys/${next.key.id}/revoke`, json('POST', undefined, admin));
        expect(((await revoked.json()) as { key: { status: string } }).key.status).toBe('revoked');
        expect((await call(`/__admin/api-keys/${next.key.id}/rotate`, json('POST', undefined, admin))).status).toBe(
            409,
        );
        expect((await call('/__admin/api-keys/missing/revoke', json('POST', undefined, admin))).status).toBe(404);
    });

    it('validates input, rejects cross-origin writes and unknown routes', async () => {
        const { call, get, create, member, administrator } = await setup();
        const admin = await administrator();
        const owner = await member('owner@example.test');
        for (const body of [
            {},
            { name: '', ownerId: owner.id, scopes: [] },
            { name: 'k', ownerId: owner.id, scopes: ['BAD SCOPE'] },
            { name: 'k', ownerId: owner.id, scopes: [], expiresInDays: 0 },
            { name: 'k', ownerId: owner.id, scopes: [], expiresInDays: 9999 },
            { name: 'k', ownerId: owner.id, scopes: [], extra: true },
            { name: 'k', ownerId: owner.id, scopes: [], metadata: { revokedAt: 'x' } },
            { name: 'k', ownerId: owner.id, scopes: [], rateLimit: { requests: 0 } },
        ]) {
            expect((await create(admin, body)).status, JSON.stringify(body)).toBe(400);
        }
        expect((await create(admin, { name: 'k', ownerId: 'nobody', scopes: [] })).status).toBe(404);
        const cross = await call(
            '/__admin/api-keys',
            json('POST', { name: 'k', ownerId: owner.id, scopes: [] }, admin, 'https://evil.example'),
        );
        expect(cross.status).toBe(403);
        expect(await cross.json()).toMatchObject({ error: { code: 'ADMIN_ORIGIN_DENIED' } });
        expect((await get('/__admin/api-keys?limit=0', admin)).status).toBe(400);
        expect((await get('/__admin/api-keys?bogus=1', admin)).status).toBe(400);
        expect((await get('/__admin/api-keys/unknown/extra', admin)).status).toBe(404);
        expect((await get('/__admin/api-keys/x/revoke', admin)).status).toBe(404);
    });

    it('requires the api-key/create action on top of the admin boundary', async () => {
        const policies = roleBasedAdminPolicies().map((policy) =>
            policy.resource === 'api-key'
                ? {
                      ...policy,
                      actions: {
                          read: policy.actions.read,
                          revoke: policy.actions.revoke,
                          rotate: policy.actions.rotate,
                      },
                  }
                : policy,
        ) as PolicyDefinition[];
        const { get, create, member, administrator } = await setup(policies);
        const admin = await administrator();
        const owner = await member('owner@example.test');
        // A missing policy action denies.
        expect(await (await get('/__admin/api-keys/capabilities', admin)).json()).toEqual({
            read: true,
            create: false,
            revoke: true,
            rotate: true,
        });
        expect((await get('/__admin/api-keys', admin)).status).toBe(200);
        expect((await create(admin, { name: 'k', ownerId: owner.id, scopes: [] })).status).toBe(403);
    });

    it('authenticates real keys against an opted-in resource: scopes, owner policies, revocation, rate limits', async () => {
        const { call, create, member, administrator, memory, backend } = await setup();
        const admin = await administrator();
        const owner = await member('owner@example.test');
        const sessions = memory.records.Session.length;
        const issue = async (body: object) =>
            (await (await create(admin, { ownerId: owner.id, ...body })).json()) as {
                key: { id: string };
                secret: string;
            };
        const reader = await issue({ name: 'reader', scopes: ['projects:read'] });
        const creator = await issue({ name: 'creator', scopes: ['projects:create'] });
        const limited = await issue({
            name: 'limited',
            scopes: ['projects:read'],
            rateLimit: { requests: 2, windowSeconds: 60 },
        });
        const use = (secret: string, path = '/api/projects', init: RequestInit = {}) =>
            call(path, { ...init, headers: { 'x-api-key': secret, 'content-type': 'application/json' } });

        const read = await use(reader.secret);
        expect(read.status).toBe(200);
        // The ABAC scope policy saw an api-key subject owned by the key's owner.
        expect(backend.all).toHaveBeenLastCalledWith({
            filters: [{ ownerId: { equals: owner.id } }],
            orderBy: [],
            limit: 20,
        });
        expect(memory.records.Session).toHaveLength(sessions);
        // Scope allows create only with the override scope; the read scope is insufficient.
        expect(
            (await use(reader.secret, '/api/projects', { method: 'POST', body: '{"name":"n","ownerId":"o"}' })).status,
        ).toBe(403);
        expect(
            (await use(creator.secret, '/api/projects', { method: 'POST', body: '{"name":"n","ownerId":"o"}' })).status,
        ).toBe(201);
        expect((await use(creator.secret)).status).toBe(403);
        // A session cookie cannot use an api-key-only resource; a key cannot reach admin or the session endpoints.
        expect((await call('/api/projects', { headers: { cookie: admin } })).status).toBe(401);
        expect((await call('/__admin/resources', { headers: { 'x-api-key': reader.secret } })).status).toBe(401);
        expect((await call('/__admin/api-keys', { headers: { 'x-api-key': reader.secret } })).status).toBe(401);
        expect(
            await (await call('/api/auth/get-session', { headers: { 'x-api-key': reader.secret } })).json(),
        ).toBeNull();

        expect((await use(limited.secret)).status).toBe(200);
        expect((await use(limited.secret)).status).toBe(200);
        const throttled = await use(limited.secret);
        expect(throttled.status).toBe(429);
        expect(Number(throttled.headers.get('retry-after'))).toBeGreaterThan(0);

        // Revocation and rotation take effect on the next request; failures reveal nothing about the credential.
        await call(`/__admin/api-keys/${reader.key.id}/revoke`, json('POST', undefined, admin));
        const revoked = await use(reader.secret);
        expect(revoked.status).toBe(401);
        expect(revoked.headers.get('www-authenticate')).toBe('X-API-Key');
        expect(await revoked.json()).toEqual({
            error: { code: 'API_KEY_REVOKED', message: 'The API key has been revoked.' },
        });
        const bad = await use('nes_live_notarealkeynotarealkeynotarealkey');
        expect(await bad.text()).not.toContain('notarealkey');
        const rotated = (await (
            await call(`/__admin/api-keys/${creator.key.id}/rotate`, json('POST', undefined, admin))
        ).json()) as { secret: string };
        expect(
            (await use(creator.secret, '/api/projects', { method: 'POST', body: '{"name":"n","ownerId":"o"}' })).status,
        ).toBe(401);
        expect(
            (await use(rotated.secret, '/api/projects', { method: 'POST', body: '{"name":"n","ownerId":"o"}' })).status,
        ).toBe(201);
        expect(JSON.stringify(memory.records)).not.toContain(rotated.secret);
    });
});
