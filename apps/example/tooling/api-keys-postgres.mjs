// Real-database check of API keys: Better Auth's API-key plugin over the Nestrum adapter and PostgreSQL.
//
// Not part of `pnpm check`: it needs a reachable identity database migrated with the example identity contract.
//   INTEGRATION_IDENTITY_URL   PostgreSQL URL of a database migrated with the example identity contract
//   NESTRUM_CONTRACT_JSON      path to that database's generated contract.json
// It exercises hashing at rest, expiry, revocation, rotation, and the atomic rate-limit boundary under concurrency.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defineAuth } from '@nestrum/auth';
import { API_KEY_HEADER, defineApplication } from '@nestrum/core';
import postgres from '@nestrum/example-postgres';
import { createHonoRuntime } from '@nestrum/hono';

const url = process.env.INTEGRATION_IDENTITY_URL;
const client = postgres({ contractJson: JSON.parse(readFileSync(process.env.NESTRUM_CONTRACT_JSON, 'utf8')), url });
const BASE = 'http://127.0.0.1:3198';
const application = defineApplication({
    apps: [],
    databases: {
        default: { kind: 'prisma', provider: 'postgresql', connection: url },
        identity: { kind: 'prisma', provider: 'postgresql', connection: url },
    },
    auth: defineAuth({
        database: 'identity',
        baseURL: BASE,
        secret: 'local-verification-secret-with-at-least-32-chars',
        prisma: () => ({ database: 'identity', collections: client.orm.public }),
    }),
    databaseLifecycle: {
        default: { connect: async () => {}, disconnect: async () => {} },
        identity: { connect: async () => client.connect(), disconnect: async () => client.close() },
    },
});
const runtime = createHonoRuntime({ application, onError: () => {} });
await runtime.start();
try {
    const { apiKeys } = application.auth;
    const signUp = await runtime.fetch(
        new Request(`${BASE}/api/auth/sign-up/email`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: BASE },
            body: JSON.stringify({
                name: 'Owner',
                email: `keys-${Date.now()}@example.test`,
                password: 'Local-password-2026!',
            }),
        }),
    );
    const owner = (await signUp.json()).user.id;
    const use = (secret) =>
        apiKeys.authenticate(new Request(`${BASE}/api/x`, { headers: { [API_KEY_HEADER]: secret } }));
    const code = async (promise) => {
        try {
            await promise;
            return 'ok';
        } catch (error) {
            return error.code;
        }
    };

    const created = await apiKeys.create({
        name: 'Real',
        ownerId: owner,
        scopes: ['projects:read', 'events:*'],
        expiresInDays: 3,
    });
    assert.match(created.secret, /^nes_live_/);
    const raw = await client.orm.public.ApiKey.where({ id: created.key.id }).all();
    assert.equal(raw.length, 1);
    assert.notEqual(raw[0].key, created.secret, 'Only a hash is stored.');
    assert.ok(!JSON.stringify(raw).includes(created.secret));
    const principal = await use(created.secret);
    assert.deepEqual(principal.scopes, ['events:*', 'projects:read']);
    assert.equal(principal.owner.id, owner);
    assert.ok((await apiKeys.list({ limit: 10, offset: 0, ownerId: owner })).keys[0].lastUsedAt);
    console.log('Real PostgreSQL key creation, hashed storage, authentication and last-use tracking passed.');

    // The rate-limit boundary is exact even when requests race: 5 allowed, the rest refused.
    const limited = await apiKeys.create({
        name: 'Limited',
        ownerId: owner,
        scopes: [],
        rateLimit: { requests: 5, windowSeconds: 120 },
    });
    const outcomes = await Promise.all(Array.from({ length: 12 }, () => code(use(limited.secret))));
    assert.equal(outcomes.filter((outcome) => outcome === 'ok').length, 5, JSON.stringify(outcomes));
    assert.ok(outcomes.filter((outcome) => outcome !== 'ok').every((outcome) => outcome === 'API_KEY_RATE_LIMITED'));
    console.log('Real PostgreSQL rate-limit boundary under concurrency passed.');

    // Expiry: a key past its expiry fails and is removed by the plugin; revocation keeps the record.
    await client.orm.public.ApiKey.where({ id: created.key.id }).update({
        expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    assert.equal(await code(use(created.secret)), 'API_KEY_EXPIRED');
    assert.equal((await client.orm.public.ApiKey.where({ id: created.key.id }).all()).length, 0);
    const toRevoke = await apiKeys.create({ name: 'Revoke me', ownerId: owner, scopes: [] });
    const revoked = await apiKeys.revoke(toRevoke.key.id);
    assert.equal(revoked.status, 'revoked');
    assert.ok(revoked.revokedAt);
    assert.equal(await code(use(toRevoke.secret)), 'API_KEY_REVOKED');
    assert.equal((await client.orm.public.ApiKey.where({ id: toRevoke.key.id }).all()).length, 1);

    // Rotation: a replacement is revealed once and the predecessor stops working.
    const rotated = await apiKeys.rotate(limited.key.id);
    assert.equal(await code(use(limited.secret)), 'API_KEY_REVOKED');
    assert.equal(await code(use(rotated.secret)), 'ok');
    assert.equal(rotated.key.rateLimit.requests, 5);
    assert.ok(!JSON.stringify(await apiKeys.list({ limit: 50, offset: 0 })).includes(rotated.secret));
    console.log('Real PostgreSQL expiry, revocation and rotation passed.');
} finally {
    await runtime.shutdown();
}
