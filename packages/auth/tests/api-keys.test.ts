import type { ApiKeyError } from '@nestrum/core';
import { API_KEY_HEADER, AppError, defineApplication } from '@nestrum/core';
import { createHonoRuntime } from '@nestrum/hono';
import { describe, expect, it, vi } from 'vitest';
import { defineAuth } from '../src/index.js';
import { storage } from './fixtures.js';

const BASE_URL = 'http://localhost:3000';
const SECRET = 'nestrum-test-secret-longer-than-thirty-two-characters';

async function setup(apiKeys: Parameters<typeof defineAuth>[0]['apiKeys'] = {}) {
    const memory = storage();
    const application = defineApplication({
        apps: [],
        databases: {
            default: { kind: 'prisma', provider: 'postgresql', connection: 'unused' },
            identity: { kind: 'prisma', provider: 'postgresql', connection: 'unused' },
        },
        auth: defineAuth({
            database: 'identity',
            baseURL: BASE_URL,
            secret: SECRET,
            prisma: () => memory.binding,
            apiKeys,
        }),
    });
    const runtime = createHonoRuntime({ application, onError: () => {} });
    await runtime.start();
    const signUp = async (email: string) => {
        const response = await runtime.fetch(
            new Request(`${BASE_URL}/api/auth/sign-up/email`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', origin: BASE_URL },
                body: JSON.stringify({ name: 'Owner', email, password: 'a-valid-password-123' }),
            }),
        );
        return ((await response.json()) as { user: { id: string } }).user.id;
    };
    // biome-ignore lint/style/noNonNullAssertion: auth is configured above
    const keys = application.auth!.apiKeys;
    const withKey = (secret: string) =>
        new Request(`${BASE_URL}/api/things`, { headers: { [API_KEY_HEADER]: secret } });

    return { application, runtime, memory, keys, signUp, withKey };
}

async function failure(promise: Promise<unknown>): Promise<ApiKeyError> {
    try {
        await promise;
    } catch (error) {
        return error as ApiKeyError;
    }
    throw new Error('Expected a failure.');
}

describe('API keys backed by the Better Auth plugin', () => {
    it('creates recognizable keys, reveals the secret once and stores only a hash', async () => {
        const { keys, memory, signUp } = await setup();
        const owner = await signUp('a@example.test');
        const created = await keys.create({ name: 'CI', ownerId: owner, scopes: ['projects:write', 'projects:read'] });
        expect(created.secret).toMatch(/^nes_live_[A-Za-z]{64}$/);
        expect(created.key).toMatchObject({
            name: 'CI',
            owner: { type: 'user', id: owner },
            scopes: ['projects:read', 'projects:write'],
            status: 'active',
            expiresAt: null,
            lastUsedAt: null,
            revokedAt: null,
            rateLimit: { enabled: true, requests: 1000, windowSeconds: 60 },
        });
        expect(created.key.start).toBe(created.secret.slice(0, created.key.start.length));
        expect(created.key.start.length).toBeLessThan(created.secret.length / 2);
        // Plaintext is never persisted; the row carries a hash.
        const stored = memory.records.ApiKey[0] as { key: string };
        expect(JSON.stringify(memory.records)).not.toContain(created.secret);
        expect(stored.key).not.toBe(created.secret);
        expect(stored.key.length).toBeGreaterThan(20);
        // Later reads never contain the secret or its hash.
        const page = await keys.list({ limit: 10, offset: 0 });
        expect(page.total).toBe(1);
        expect(JSON.stringify(page)).not.toContain(created.secret);
        expect(JSON.stringify(page)).not.toContain(stored.key);
        expect(page.keys[0]).not.toHaveProperty('secret');
        expect(page.keys[0]).not.toHaveProperty('key');
    });

    it('supports a custom prefix, explicit expiry and the default TTL', async () => {
        const { keys, signUp } = await setup({ prefix: 'nes_test_', defaultTtlDays: 30, maxTtlDays: 90 });
        const owner = await signUp('a@example.test');
        const byDefault = await keys.create({ name: 'Default', ownerId: owner, scopes: [] });
        expect(byDefault.secret.startsWith('nes_test_')).toBe(true);
        const days = (Date.parse(byDefault.key.expiresAt as string) - Date.now()) / 86_400_000;
        expect(days).toBeGreaterThan(29.9);
        expect(days).toBeLessThanOrEqual(30);
        const explicit = await keys.create({ name: 'Explicit', ownerId: owner, scopes: [], expiresInDays: 7 });
        expect((Date.parse(explicit.key.expiresAt as string) - Date.now()) / 86_400_000).toBeLessThanOrEqual(7);
        await expect(
            keys.create({ name: 'Long', ownerId: owner, scopes: [], expiresInDays: 91 }),
        ).rejects.toMatchObject({
            code: 'API_KEY_INVALID_INPUT',
        });
    });

    it('validates creation input and owners', async () => {
        const { keys, signUp } = await setup();
        const owner = await signUp('a@example.test');
        const bad = (input: object) =>
            expect(keys.create({ name: 'k', ownerId: owner, scopes: [], ...input } as never));
        await bad({ name: '' }).rejects.toMatchObject({ status: 400 });
        await bad({ name: 'x'.repeat(65) }).rejects.toMatchObject({ status: 400 });
        await bad({ scopes: ['Projects:Read'] }).rejects.toMatchObject({ code: 'API_KEY_SCOPES_INVALID' });
        await bad({ scopes: 'projects:read' }).rejects.toMatchObject({ code: 'API_KEY_SCOPES_INVALID' });
        await bad({ expiresInDays: 0 }).rejects.toMatchObject({ status: 400 });
        await bad({ expiresInDays: 1.5 }).rejects.toMatchObject({ status: 400 });
        await bad({ rateLimit: { requests: 0 } }).rejects.toMatchObject({ status: 400 });
        await bad({ metadata: { revokedAt: 'x' } }).rejects.toMatchObject({ status: 400 });
        await bad({ metadata: [] }).rejects.toMatchObject({ status: 400 });
        await bad({ ownerId: 'nobody' }).rejects.toMatchObject({ code: 'API_KEY_OWNER_NOT_FOUND', status: 404 });
        await bad({ ownerId: 5 }).rejects.toMatchObject({ status: 400 });
    });

    it('authenticates a valid key into a principal without creating a Better Auth session', async () => {
        const { keys, memory, signUp, withKey } = await setup();
        const owner = await signUp('a@example.test');
        const sessions = memory.records.Session.length;
        const created = await keys.create({ name: 'CI', ownerId: owner, scopes: ['projects:read'] });
        const principal = await keys.authenticate(withKey(created.secret));
        expect(principal).toEqual({
            id: created.key.id,
            name: 'CI',
            owner: { type: 'user', id: owner },
            scopes: ['projects:read'],
        });
        expect(memory.records.Session).toHaveLength(sessions);
        const after = (await keys.list({ limit: 1, offset: 0 })).keys[0];
        expect(after?.lastUsedAt).not.toBeNull();
        expect(await keys.authenticate(new Request(`${BASE_URL}/x`))).toBeNull();
    });

    it('rejects malformed, unknown, revoked and expired keys without echoing the credential', async () => {
        const { keys, memory, signUp, withKey } = await setup();
        const owner = await signUp('a@example.test');
        const live = await keys.create({ name: 'live', ownerId: owner, scopes: ['a:read'] });
        const revoked = await keys.create({ name: 'revoked', ownerId: owner, scopes: ['a:read'] });
        const expired = await keys.create({ name: 'expired', ownerId: owner, scopes: ['a:read'], expiresInDays: 1 });
        await keys.revoke(revoked.key.id);
        const row = memory.records.ApiKey.find((entry) => entry.id === expired.key.id);
        if (row) {
            row.expiresAt = new Date(Date.now() - 1000).toISOString();
        }
        const unknown = `nes_live_${'z'.repeat(64)}`;
        for (const [secret, code] of [
            ['short', 'API_KEY_INVALID'],
            ['has space in it but long enough to pass', 'API_KEY_INVALID'],
            [unknown, 'API_KEY_INVALID'],
            [revoked.secret, 'API_KEY_REVOKED'],
            [expired.secret, 'API_KEY_EXPIRED'],
        ] as const) {
            const error = await failure(keys.authenticate(withKey(secret)));
            expect(error, secret).toMatchObject({ code, status: 401 });
            expect(error.headers).toEqual({ 'WWW-Authenticate': 'X-API-Key' });
            expect(error.message).not.toContain(secret);
            expect(String(error.cause ?? '')).not.toContain(secret);
        }
        // Failed credentials never update the live key's metadata.
        expect(
            (await keys.list({ limit: 10, offset: 0 })).keys.find((key) => key.id === live.key.id)?.lastUsedAt,
        ).toBeNull();
        // An expired key is gone once verified; a revoked key is kept.
        expect(memory.records.ApiKey.some((entry) => entry.id === revoked.key.id)).toBe(true);
    });

    it('keeps credentials out of every log line emitted while verifying', async () => {
        const lines: string[] = [];
        const capture = (...args: unknown[]) =>
            void lines.push(args.map((arg) => JSON.stringify(arg) ?? String(arg)).join(' '));
        const spies = (['error', 'warn', 'info', 'log', 'debug'] as const).map((level) =>
            vi.spyOn(console, level).mockImplementation(capture),
        );
        try {
            const { keys, signUp, withKey } = await setup({ rateLimit: { requests: 1, windowSeconds: 60 } });
            const owner = await signUp('a@example.test');
            const created = await keys.create({ name: 'k', ownerId: owner, scopes: [] });
            const unknown = `nes_live_${'q'.repeat(64)}`;
            await keys.authenticate(withKey(created.secret));
            await failure(keys.authenticate(withKey(created.secret)));
            await failure(keys.authenticate(withKey(unknown)));
            await keys.revoke(created.key.id);
            await failure(keys.authenticate(withKey(created.secret)));
            expect(lines.length).toBeGreaterThan(0);
            const output = lines.join('\n');
            expect(output).not.toContain(created.secret);
            expect(output).not.toContain(unknown);
            expect(output).not.toContain(created.secret.slice(9));
        } finally {
            for (const spy of spies) {
                spy.mockRestore();
            }
        }
    });

    it('rejects keys whose owner no longer exists', async () => {
        const { keys, memory, signUp, withKey } = await setup();
        const owner = await signUp('a@example.test');
        const created = await keys.create({ name: 'k', ownerId: owner, scopes: [] });
        memory.records.User.length = 0;
        expect(await failure(keys.authenticate(withKey(created.secret)))).toMatchObject({ code: 'API_KEY_INVALID' });
    });

    it('revokes by recording revokedAt, keeps the record and is idempotent', async () => {
        const { keys, memory, signUp } = await setup();
        const owner = await signUp('a@example.test');
        const created = await keys.create({ name: 'k', ownerId: owner, scopes: [], metadata: { team: 'core' } });
        const revoked = await keys.revoke(created.key.id);
        expect(revoked.status).toBe('revoked');
        expect(revoked.revokedAt).toMatch(/^\d{4}-/);
        expect(revoked.metadata).toEqual({ team: 'core' });
        expect(memory.records.ApiKey).toHaveLength(1);
        expect((await keys.revoke(created.key.id)).revokedAt).toBe(revoked.revokedAt);
        await expect(keys.revoke('missing')).rejects.toMatchObject({ code: 'API_KEY_NOT_FOUND', status: 404 });
    });

    it('enforces the rate limit boundary per key and reports when to retry', async () => {
        const { keys, signUp, withKey } = await setup({ rateLimit: { requests: 1000, windowSeconds: 60 } });
        const owner = await signUp('a@example.test');
        const limited = await keys.create({
            name: 'limited',
            ownerId: owner,
            scopes: [],
            rateLimit: { requests: 2, windowSeconds: 60 },
        });
        const other = await keys.create({ name: 'other', ownerId: owner, scopes: [] });
        expect(await keys.authenticate(withKey(limited.secret))).not.toBeNull();
        expect(await keys.authenticate(withKey(limited.secret))).not.toBeNull();
        const denied = await failure(keys.authenticate(withKey(limited.secret)));
        expect(denied).toMatchObject({ code: 'API_KEY_RATE_LIMITED', status: 429 });
        expect(Number(denied.headers['Retry-After'])).toBeGreaterThan(0);
        expect(Number(denied.headers['Retry-After'])).toBeLessThanOrEqual(60);
        expect(await keys.authenticate(withKey(other.secret))).not.toBeNull();
    });

    it('can disable rate limiting for a key', async () => {
        const { keys, signUp, withKey } = await setup({ rateLimit: { requests: 1, windowSeconds: 60 } });
        const owner = await signUp('a@example.test');
        const free = await keys.create({ name: 'free', ownerId: owner, scopes: [], rateLimit: { enabled: false } });
        for (let index = 0; index < 4; index += 1) {
            expect(await keys.authenticate(withKey(free.secret))).not.toBeNull();
        }
    });

    it('rotates: reveals a replacement once, revokes the predecessor and carries its configuration', async () => {
        const { keys, signUp, withKey } = await setup();
        const owner = await signUp('a@example.test');
        const old = await keys.create({
            name: 'CI',
            ownerId: owner,
            scopes: ['projects:read'],
            expiresInDays: 10,
            metadata: { team: 'core' },
            rateLimit: { requests: 5, windowSeconds: 30 },
        });
        const rotated = await keys.rotate(old.key.id);
        expect(rotated.secret).not.toBe(old.secret);
        expect(rotated.revoked).toMatchObject({ id: old.key.id, status: 'revoked' });
        expect(rotated.key).toMatchObject({
            name: 'CI',
            owner: { type: 'user', id: owner },
            scopes: ['projects:read'],
            status: 'active',
            metadata: { team: 'core' },
            rateLimit: { enabled: true, requests: 5, windowSeconds: 30 },
        });
        expect(Date.parse(rotated.key.expiresAt as string) - Date.now()).toBeGreaterThan(9 * 86_400_000);
        expect(await failure(keys.authenticate(withKey(old.secret)))).toMatchObject({ code: 'API_KEY_REVOKED' });
        expect(await keys.authenticate(withKey(rotated.secret))).toMatchObject({ id: rotated.key.id });
        await expect(keys.rotate(old.key.id)).rejects.toMatchObject({ code: 'API_KEY_NOT_ROTATABLE', status: 409 });
        expect(JSON.stringify(await keys.list({ limit: 10, offset: 0 }))).not.toContain(rotated.secret);
    });

    it('revokes the replacement when the predecessor cannot be revoked', async () => {
        const { keys, memory, signUp } = await setup();
        const owner = await signUp('a@example.test');
        const old = await keys.create({ name: 'CI', ownerId: owner, scopes: [] });
        const records = memory.records.ApiKey;
        const original = records.push.bind(records);
        // Fail the predecessor update by making the row disappear after the replacement is issued.
        records.push = (...items) => {
            const result = original(...items);
            records.splice(
                records.findIndex((entry) => entry.id === old.key.id),
                1,
            );
            return result;
        };
        await expect(keys.rotate(old.key.id)).rejects.toBeInstanceOf(Error);
        records.push = original;
        expect(records.every((entry) => entry.enabled === false)).toBe(true);
    });

    it('lists newest first, paginates and filters by owner', async () => {
        const { keys, signUp } = await setup();
        const first = await signUp('a@example.test');
        const second = await signUp('b@example.test');
        for (const [name, owner] of [
            ['one', first],
            ['two', second],
            ['three', first],
        ] as const) {
            await keys.create({ name, ownerId: owner, scopes: [] });
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        expect((await keys.list({ limit: 2, offset: 0 })).keys.map((key) => key.name)).toEqual(['three', 'two']);
        expect((await keys.list({ limit: 2, offset: 2 })).keys.map((key) => key.name)).toEqual(['one']);
        const owned = await keys.list({ limit: 10, offset: 0, ownerId: first });
        expect(owned).toMatchObject({ total: 2 });
        expect(owned.keys.map((key) => key.name)).toEqual(['three', 'one']);
        await expect(keys.list({ limit: 0, offset: 0 })).rejects.toBeInstanceOf(AppError);
    });

    it('is not reachable over HTTP and never makes a key a session', async () => {
        const { runtime, keys, signUp } = await setup();
        const owner = await signUp('a@example.test');
        const created = await keys.create({ name: 'k', ownerId: owner, scopes: [] });
        for (const path of ['/api/auth/api-key/create', '/api/auth/api-key/list', '/api/auth/api-key/verify']) {
            const response = await runtime.fetch(
                new Request(`${BASE_URL}${path}`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', origin: BASE_URL, [API_KEY_HEADER]: created.secret },
                    body: JSON.stringify({ key: created.secret }),
                }),
            );
            expect(response.status).toBe(404);
        }
        const session = await runtime.fetch(
            new Request(`${BASE_URL}/api/auth/get-session`, { headers: { [API_KEY_HEADER]: created.secret } }),
        );
        expect(await session.json()).toBeNull();
    });
});
