// Real-database check of enterprise SSO: Nestrum's SsoProvider model through the Prisma query backend on PostgreSQL.
//
// Not part of `pnpm check`: it needs a reachable identity database migrated with the example identity contract.
//   INTEGRATION_IDENTITY_URL   PostgreSQL URL of a database migrated with the example identity contract
//   NESTRUM_CONTRACT_JSON      path to that database's generated contract.json
// It runs a local OpenID provider and exercises secret encryption at rest, the unique provider id under concurrent
// writers, a full authorization-code sign-in that records the SSO session context, disabling, and delete semantics.
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { defineAuth } from '@nestrum/auth';
import { defineApplication } from '@nestrum/core';
import postgres from '@nestrum/example-postgres';
import { createHonoRuntime } from '@nestrum/hono';

const url = process.env.INTEGRATION_IDENTITY_URL;
const client = postgres({ contractJson: JSON.parse(readFileSync(process.env.NESTRUM_CONTRACT_JSON, 'utf8')), url });
const BASE = 'http://127.0.0.1:3197';
const b64 = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
let issuer = '';
const idp = createServer(async (request, response) => {
    const path = new URL(request.url, issuer).pathname;
    const send = (body) => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(body));
    };
    if (path === '/.well-known/openid-configuration') {
        return send({
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            jwks_uri: `${issuer}/jwks`,
            userinfo_endpoint: `${issuer}/userinfo`,
            token_endpoint_auth_methods_supported: ['client_secret_basic'],
        });
    }
    if (path === '/jwks') {
        return send({ keys: [jwk] });
    }
    if (path === '/userinfo') {
        return send({ sub: 'subject-1', email, email_verified: true, name: 'Verifier' });
    }
    if (path === '/token') {
        for await (const _ of request);
        const now = Math.floor(Date.now() / 1000);
        const head = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
        const body = b64({
            iss: issuer,
            aud: 'client-1',
            sub: 'subject-1',
            iat: now,
            exp: now + 300,
            email,
            email_verified: true,
        });
        const signature = sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url');

        return send({
            access_token: 'access',
            token_type: 'Bearer',
            id_token: `${head}.${body}.${signature}`,
            expires_in: 300,
        });
    }
    response.writeHead(404).end();
});
await new Promise((resolve) => idp.listen(0, '127.0.0.1', resolve));
issuer = `http://127.0.0.1:${idp.address().port}`;
const email = `sso-${Date.now()}@verify.test`;

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
        sso: { enabled: true, trustedIdpOrigins: [issuer] },
    }),
    databaseLifecycle: {
        default: { connect: async () => {}, disconnect: async () => {} },
        identity: { connect: async () => client.connect(), disconnect: async () => client.close() },
    },
});
const runtime = createHonoRuntime({ application, onError: () => {} });
await runtime.start();
const providerId = `verify-${Date.now().toString(36)}`;
try {
    const { sso } = application.auth;
    const table = client.orm.public.SsoProvider;
    const config = {
        type: 'oidc',
        providerId,
        displayName: 'Verification IdP',
        organizationId: 'org-verify',
        domains: ['verify.test'],
        issuer,
        clientId: 'client-1',
        clientSecret: 'verification-client-secret',
    };

    // Concurrent creation with one id: exactly one wins, the rest fail cleanly.
    const races = await Promise.allSettled([sso.create(config), sso.create(config), sso.create(config)]);
    assert.equal(races.filter((entry) => entry.status === 'fulfilled').length, 1, 'One concurrent creation must win.');
    assert.equal((await table.where({ providerId }).all()).length, 1);

    // Secrets are sealed at rest and never returned.
    const [row] = await table.where({ providerId }).all();
    assert.ok(
        !JSON.stringify(row).includes('verification-client-secret'),
        'The secret must not be stored in plaintext.',
    );
    assert.match(JSON.parse(row.oidcConfig).clientSecret, /^nsso1:/);
    assert.equal(row.enabled, true);
    assert.ok(row.lastValidatedAt, 'Validation time is persisted as a timestamp.');
    const summary = await sso.get(providerId);
    assert.equal(summary.clientSecretConfigured, true);
    assert.ok(!JSON.stringify(summary).includes('verification-client-secret'));

    // Editing display name keeps the secret and the provider id.
    await sso.update(providerId, { displayName: 'Renamed' });
    assert.equal((await sso.get(providerId)).providerId, providerId);
    assert.match(JSON.parse((await table.where({ providerId }).all())[0].oidcConfig).clientSecret, /^nsso1:/);

    // A full SP-initiated sign-in through the plugin creates a session tagged with the provider.
    const start = await runtime.fetch(
        new Request(`${BASE}/api/auth/sign-in/sso`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: BASE },
            body: JSON.stringify({ email, callbackURL: `${BASE}/done` }),
        }),
    );
    assert.equal(start.status, 200);
    const authorization = new URL((await start.json()).url);
    const cookie = start.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; ');
    const callback = await runtime.fetch(
        new Request(
            `${BASE}/api/auth/sso/callback/${providerId}?code=abc&state=${authorization.searchParams.get('state')}`,
            {
                headers: { cookie },
            },
        ),
    );
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get('location'), `${BASE}/done`);
    const sessionCookie = callback.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; ');
    const session = await application.auth.getSession(new Request(BASE, { headers: { cookie: sessionCookie } }));
    assert.equal(session.session.authMethod, 'sso');
    assert.equal(session.session.ssoProviderId, providerId);
    const subject = await application.auth.resolveSubject(new Request(BASE, { headers: { cookie: sessionCookie } }));
    assert.deepEqual(
        { authMethod: subject.authMethod, ssoProviderId: subject.ssoProviderId, role: subject.role },
        {
            authMethod: 'sso',
            ssoProviderId: providerId,
            role: 'user',
        },
    );
    assert.ok((await sso.get(providerId)).lastSuccessfulLoginAt, 'The last successful sign-in is recorded.');

    // Disabled providers reject new sign-ins; existing sessions keep working.
    await sso.setEnabled(providerId, false, { actorId: 'verifier' });
    const blocked = await runtime.fetch(
        new Request(`${BASE}/api/auth/sign-in/sso`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: BASE },
            body: JSON.stringify({ providerId, callbackURL: `${BASE}/done` }),
        }),
    );
    assert.equal(blocked.status, 404);
    assert.ok(await application.auth.getSession(new Request(BASE, { headers: { cookie: sessionCookie } })));

    // Deleting removes configuration only.
    const users = await client.orm.public.User.where({ email }).all();
    assert.equal(users.length, 1);
    await sso.delete(providerId);
    assert.equal((await table.where({ providerId }).all()).length, 0);
    assert.equal((await client.orm.public.User.where({ email }).all()).length, 1, 'Users survive provider deletion.');
    assert.ok(await application.auth.getSession(new Request(BASE, { headers: { cookie: sessionCookie } })));
    console.log('Real PostgreSQL SSO verification passed.');
} finally {
    await runtime.stop?.();
    await application.stop?.();
    idp.close();
}
