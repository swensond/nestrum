import { AppError, allow, defineApplication, defineResource, deny } from '@nestrum/core';
import { createHonoRuntime } from '@nestrum/hono';
import { describe, expect, it, vi } from 'vitest';
import { AUTH_MODELS, authContract, createPrismaAuthAdapter, defineAuth, SubjectFactory } from '../src/index.js';
import { storage } from './fixtures.js';

const BASE_URL = 'http://localhost:3000';
const SECRET = 'nestrum-test-secret-longer-than-thirty-two-characters';
const DATABASES = {
    default: { kind: 'prisma' as const, provider: 'postgresql' as const, connection: 'unused' },
    identity: { kind: 'prisma' as const, provider: 'postgresql' as const, connection: 'unused' },
};
function request(path: string, body?: object, cookie?: string) {
    return new Request(`${BASE_URL}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
            ...(body ? { 'content-type': 'application/json', origin: BASE_URL } : {}),
            ...(cookie ? { cookie } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
}
function cookies(response: Response): string {
    return response.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; ');
}

describe('Framework-owned Better Auth', () => {
    it('registers, hashes passwords, logs in/out, retrieves sessions and binds subjects on a named database', async () => {
        const memory = storage();
        const prisma = vi.fn(() => memory.binding);
        const auth = defineAuth({
            database: 'identity',
            baseURL: BASE_URL,
            secret: SECRET,
            prisma,
        });
        const application = defineApplication({
            apps: [],
            databases: DATABASES,
            auth,
            policies: [
                {
                    resource: 'private',
                    actions: {
                        read: {
                            authorize: ({ subject }) => (typeof subject.id === 'string' ? allow() : deny('ANONYMOUS')),
                        },
                    },
                },
            ],
        });
        const runtime = createHonoRuntime({ application, onError: vi.fn() });
        runtime.hono.get('/private', async (context) => {
            const decision = await context.var.nestrum.authorization.authorize({
                identity: 'private',
                action: 'read',
                subject: context.var.nestrum.subject,
                environment: context.var.nestrum.environment,
            });
            if (!decision.allowed) {
                throw new AppError('DENIED', 'Login required.', 403);
            }

            return context.json(context.var.nestrum.subject);
        });
        await runtime.start();
        expect(prisma).toHaveBeenCalledOnce();
        expect(prisma.mock.calls[0]).toEqual([{ application, database: 'identity', definition: DATABASES.identity }]);
        expect(application.apps.has('nestrum.auth')).toBe(true);
        const signup = await runtime.fetch(
            request('/api/auth/sign-up/email', {
                name: 'Alice',
                email: 'alice@example.com',
                password: 'a-valid-password-123',
                staff: true,
            }),
        );
        expect(signup.status).toBe(200);
        const registered = (await signup.json()) as { user: { id: string; twoFactorEnabled: boolean } };
        // Unknown body fields are never persisted, and a new user starts without a second factor.
        expect(registered.user).not.toHaveProperty('staff');
        expect(registered.user.twoFactorEnabled).toBe(false);
        expect(memory.records.User).toHaveLength(1);
        expect(memory.records.Account).toHaveLength(1);
        expect(memory.records.Account[0]!.password).not.toBe('a-valid-password-123');
        expect(typeof memory.records.Account[0]!.password).toBe('string');
        expect(typeof memory.records.Session[0]!.expiresAt).toBe('string');
        const cookie = cookies(signup);
        expect(cookie).toContain('session_token=');
        const session = await runtime.fetch(request('/api/auth/get-session', undefined, cookie));
        expect(session.status).toBe(200);
        expect(await session.json()).toMatchObject({ user: { id: registered.user.id } });
        expect(await (await runtime.fetch(request('/private', undefined, cookie))).json()).toEqual({
            id: registered.user.id,
            anonymous: false,
            role: 'user',
        });
        const spoofed = await runtime.fetch(
            new Request(`${BASE_URL}/private`, {
                headers: { 'x-user-id': registered.user.id, authorization: 'Bearer forged' },
            }),
        );
        expect(spoofed.status).toBe(403);
        expect((await runtime.fetch(request('/api/auth/sign-out', {}, cookie))).status).toBe(200);
        expect((await runtime.fetch(request('/private', undefined, cookie))).status).toBe(403);
        expect(await (await runtime.fetch(request('/api/auth/get-session', undefined, cookie))).json()).toBeNull();
        const wrong = await runtime.fetch(
            request('/api/auth/sign-in/email', { email: 'alice@example.com', password: 'wrong-password' }),
        );
        expect(wrong.status).toBe(401);
        const login = await runtime.fetch(
            request('/api/auth/sign-in/email', { email: 'alice@example.com', password: 'a-valid-password-123' }),
        );
        expect(login.status).toBe(200);
        expect((await runtime.fetch(request('/private', undefined, cookies(login)))).status).toBe(200);
        expect(
            (await runtime.fetch(request('/api/auth/update-user', { name: 'Changed' }, cookies(login)))).status,
        ).toBe(404);
        await runtime.shutdown();
    });

    it('rejects foreign origins, bad registration input, forged cookies and expired sessions', async () => {
        const memory = storage();
        const application = defineApplication({
            apps: [],
            databases: DATABASES,
            auth: defineAuth({ database: 'identity', baseURL: BASE_URL, secret: SECRET, prisma: () => memory.binding }),
        });
        const runtime = createHonoRuntime({ application });
        await runtime.start();
        const badOrigin = new Request(`${BASE_URL}/api/auth/sign-up/email`, {
            method: 'POST',
            headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Alice', email: 'alice@example.com', password: 'a-valid-password-123' }),
        });
        expect((await runtime.fetch(badOrigin)).status).toBe(403);
        expect(
            (
                await runtime.fetch(
                    request('/api/auth/sign-up/email', { name: 'Alice', email: 'invalid', password: 'short' }),
                )
            ).status,
        ).toBe(400);
        expect(memory.records.User).toHaveLength(0);
        expect(
            await application.auth!.resolveSubject(request('/private', undefined, 'better-auth.session_token=forged')),
        ).toEqual({ anonymous: true });
        const registered = await runtime.fetch(
            request('/api/auth/sign-up/email', {
                name: 'Alice',
                email: 'alice@example.com',
                password: 'a-valid-password-123',
            }),
        );
        memory.records.Session[0]!.expiresAt = new Date(0).toISOString();
        expect(await application.auth!.resolveSubject(request('/private', undefined, cookies(registered)))).toEqual({
            anonymous: true,
        });
        await runtime.shutdown();
    });

    it('protects auth models and rejects invalid database/extension configuration', async () => {
        const options = { baseURL: BASE_URL, secret: SECRET, prisma: () => storage().binding };
        expect(() => defineAuth({ ...options, secret: 'short' })).toThrow();
        for (const twoFactor of [
            { issuer: '' },
            { issuer: 'a:b' },
            { maxFailedAttempts: 0 },
            { lockoutSeconds: 1.5 },
        ]) {
            expect(() => defineAuth({ ...options, twoFactor })).toThrow(/Two-factor/);
        }
        expect(() =>
            defineApplication({
                apps: [],
                databases: DATABASES,
                auth: defineAuth({ ...options, database: 'missing' }),
            }),
        ).toThrow();
        expect(() =>
            defineApplication({
                apps: [],
                databases: DATABASES,
                auth: defineAuth({ ...options, database: 'identity' }),
                resources: [defineResource({ database: 'identity', model: 'User' })],
            }),
        ).toThrowError(/ordinary resources/);
        const mismatch = defineApplication({ apps: [], databases: DATABASES, auth: defineAuth({ ...options }) });
        await expect(mismatch.start()).rejects.toMatchObject({ code: 'AUTH_DATABASE_MISMATCH' });
    });

    it('emits owned provider contracts only for the selected database and keeps core fields protected', () => {
        const postgres = authContract('postgresql');
        const mongo = authContract('mongodb');
        for (const model of AUTH_MODELS) {
            expect(postgres).toContain(`model ${model}`);
            expect(mongo).toContain(`model ${model}`);
        }
        expect(postgres).toContain('twoFactorEnabled Boolean?');
        expect(postgres).toContain('model TwoFactor');
        expect(postgres).toContain('email String @unique');
        expect(postgres).not.toContain('model UserProfile');
        expect(mongo).toContain('@map("_id")');
        expect(postgres).not.toContain('identity');
    });
});

describe('Owned Prisma 8 adapter and subjects', () => {
    it('implements constrained CRUD, selects, counts, pagination and one-row deletion', async () => {
        const memory = storage();
        const adapter = createPrismaAuthAdapter(
            memory.binding,
            'postgresql',
        )({
            user: { modelName: 'User' },
            session: { modelName: 'Session' },
            account: { modelName: 'Account' },
            verification: { modelName: 'Verification' },
        });
        const one = await adapter.create<{ id: string; name: string; email: string }>({
            model: 'user',
            data: { name: 'One', email: 'one@example.com' },
        });
        await adapter.create({ model: 'user', data: { name: 'Two', email: 'two@example.com' } });
        expect(await adapter.count({ model: 'user' })).toBe(2);
        expect(
            await adapter.findOne({ model: 'user', where: [{ field: 'id', value: one.id }], select: ['id'] }),
        ).toEqual({ id: one.id });
        expect(
            await adapter.findMany({
                model: 'user',
                limit: 1,
                offset: 1,
                sortBy: { field: 'name', direction: 'asc' },
                select: ['name'],
            }),
        ).toEqual([{ name: 'Two' }]);
        expect(
            await adapter.update({
                model: 'user',
                where: [{ field: 'id', value: one.id }],
                update: { name: 'Changed' },
            }),
        ).toMatchObject({ id: one.id, name: 'Changed' });
        await adapter.delete({ model: 'user', where: [{ field: 'name', value: ['Changed', 'Two'], operator: 'in' }] });
        expect(await adapter.count({ model: 'user' })).toBe(1);
        expect(await adapter.deleteMany({ model: 'user', where: [{ field: 'name', value: 'Two' }] })).toBe(1);
        await expect(adapter.deleteMany({ model: 'user', where: [] })).rejects.toMatchObject({
            code: 'AUTH_QUERY_UNSUPPORTED',
        });
        await expect(
            adapter.findOne({ model: 'user', where: [{ field: 'email', value: 'x', operator: 'contains' }] }),
        ).rejects.toMatchObject({ code: 'AUTH_QUERY_UNSUPPORTED' });
    });

    it('maps only validated live sessions and permits trusted domain subject enrichment', async () => {
        const session = {
            user: { id: 'user-one', timezone: 'UTC' },
            session: { id: 'session-one', userId: 'user-one', expiresAt: new Date(Date.now() + 60_000) },
        };
        const factory = new SubjectFactory(async ({ user }) => ({ id: user.id, region: user.timezone }));
        expect(await factory.create(null)).toEqual({ anonymous: true });
        expect(await factory.create(session)).toEqual({ id: 'user-one', region: 'UTC' });
        await expect(
            factory.create({ ...session, session: { ...session.session, userId: 'other' } }),
        ).rejects.toMatchObject({ code: 'AUTH_SESSION_INVALID' });
        expect(await factory.create({ ...session, session: { ...session.session, expiresAt: new Date(0) } })).toEqual({
            anonymous: true,
        });
    });
});
