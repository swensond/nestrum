// Real-browser check of the SSO admin lifecycle for both protocols, plus a browser SP-initiated OIDC sign-in.
//
// Serves an identity-only application (PostgreSQL with the migrated identity contract) with the built admin shell and
// a local OpenID provider, and drives it with Playwright. Not part of `pnpm check`: it needs a reachable, migrated
// identity database and Playwright.
//   INTEGRATION_IDENTITY_URL   PostgreSQL URL of a database migrated with the example identity contract
//   NESTRUM_CONTRACT_JSON      path to that database's generated contract.json
//   PLAYWRIGHT_MODULE_DIR      node_modules directory that resolves `playwright` (default: this package)
//   PLAYWRIGHT_CHROMIUM        optional Chromium executable path
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { defineAdmin, roleBasedAdminPolicies } from '@nestrum/admin';
import { createAdminShell } from '@nestrum/admin-ui/node';
import { defineAuth, totpCode, totpSecretFromUri, totpStep } from '@nestrum/auth';
import { defineApplication } from '@nestrum/core';
import postgres from '@nestrum/example-postgres';
import { createHonoRuntime } from '@nestrum/hono';
import { nodeRuntime } from '../../../packages/runtime-node/dist/index.js';

const { chromium } = createRequire(`${process.env.PLAYWRIGHT_MODULE_DIR ?? import.meta.dirname}/`)('playwright');
const url = process.env.INTEGRATION_IDENTITY_URL;
const client = postgres({ contractJson: JSON.parse(readFileSync(process.env.NESTRUM_CONTRACT_JSON, 'utf8')), url });
const BASE = 'http://127.0.0.1:3196';
const PASSWORD = 'Local-password-2026!';
const b64 = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

// A local OpenID provider whose /authorize redirects straight back with a code, like an IdP with an active session.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const ssoEmail = `sso-${Date.now()}@acme.test`;
// Accounts are keyed by provider and subject and survive provider deletion, so each run needs its own subject.
const subject = `subject-${Date.now()}`;
let issuer = '';
const idp = createServer(async (request, response) => {
    const target = new URL(request.url, issuer);
    const send = (body) => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(body));
    };
    if (target.pathname === '/.well-known/openid-configuration') {
        return send({
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            jwks_uri: `${issuer}/jwks`,
            userinfo_endpoint: `${issuer}/userinfo`,
            token_endpoint_auth_methods_supported: ['client_secret_basic'],
        });
    }
    if (target.pathname === '/authorize') {
        const back = new URL(target.searchParams.get('redirect_uri'));
        back.searchParams.set('code', 'code-1');
        back.searchParams.set('state', target.searchParams.get('state'));
        response.writeHead(302, { location: back.toString() });

        return response.end();
    }
    if (target.pathname === '/jwks') {
        return send({ keys: [jwk] });
    }
    if (target.pathname === '/userinfo') {
        return send({ sub: subject, email: ssoEmail, email_verified: true, name: 'Sso Person' });
    }
    if (target.pathname === '/token') {
        for await (const _ of request);
        const now = Math.floor(Date.now() / 1000);
        const head = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
        const body = b64({
            iss: issuer,
            aud: 'client-1',
            sub: subject,
            iat: now,
            exp: now + 300,
            email: ssoEmail,
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
    admin: defineAdmin(),
    policies: roleBasedAdminPolicies(),
    databaseLifecycle: {
        default: { connect: async () => {}, disconnect: async () => {} },
        identity: { connect: async () => client.connect(), disconnect: async () => client.close() },
    },
});
let handle;
const runtime = createHonoRuntime({
    application,
    adminUi: await createAdminShell(),
    stopTraffic: async () => handle?.stopAccepting(),
    onError: () => {},
});
await runtime.start();
handle = await nodeRuntime.serve(runtime, { host: '127.0.0.1', port: 3196 });

// A CLI-created administrator is enrolled over the API; the browser then carries that verified session.
const adminEmail = `sso-admin-${Date.now()}@example.test`;
await application.auth.createAdministrator({ email: adminEmail, name: 'SSO Admin', password: PASSWORD });
const post = (path, body, cookie) =>
    fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE, ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
    });
const cookieOf = (response) =>
    response.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; ');
const login = await post('/api/auth/sign-in/email', { email: adminEmail, password: PASSWORD });
const enabled = await post('/api/auth/two-factor/enable', { password: PASSWORD }, cookieOf(login));
const secret = totpSecretFromUri((await enabled.json()).totpURI);
const verified = await post(
    '/api/auth/two-factor/verify-totp',
    { code: totpCode(secret, totpStep(Date.now())) },
    cookieOf(login),
);
assert.equal(verified.status, 200);
const adminCookie = cookieOf(verified);

// A previous run may have left its providers behind; start from a known state.
for (const providerId of ['acme-okta', 'initech-saml']) {
    await application.auth.sso.delete(providerId).catch(() => {});
}
const browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}),
    args: ['--no-sandbox'],
});
const SAML_METADATA = readFileSync(new URL('./fixtures/idp-metadata.xml', import.meta.url), 'utf8');
try {
    const context = await browser.newContext();
    await context.addCookies(
        adminCookie.split('; ').map((pair) => {
            const [name, ...value] = pair.split('=');

            return { name, value: value.join('='), url: BASE };
        }),
    );
    const page = await context.newPage();

    // 1. The page loads for a permitted administrator (the database may already hold other providers).
    await page.goto(`${BASE}/admin/auth/sso`);
    await page.getByRole('heading', { name: 'Single sign-on' }).waitFor();

    // 2. OIDC lifecycle: create (the secret is write-only), test, disable, enable.
    await page.getByRole('link', { name: 'Add a provider' }).click();
    await page.getByLabel('Display name').fill('Acme Okta');
    await page.getByLabel('Provider ID').fill('acme-okta');
    await page.getByLabel('Email domains').fill('acme.test');
    await page.getByLabel('Issuer URL').fill(issuer);
    await page.getByLabel('Client ID').fill('client-1');
    await page.getByLabel('Client secret').fill('browser-secret-value');
    await page.getByRole('button', { name: 'Add provider' }).click();
    await page.waitForURL(/\/admin\/auth\/sso\/acme-okta$/);
    await page.getByTestId('sso-redirect-uri').waitFor();
    assert.match(await page.getByTestId('sso-redirect-uri').textContent(), /\/api\/auth\/sso\/callback\/acme-okta$/);
    assert.ok(!(await page.content()).includes('browser-secret-value'), 'The secret is never rendered.');
    await page.getByPlaceholder('Configured — leave blank to keep').waitFor();
    await page.getByRole('button', { name: 'Test configuration' }).click();
    await page.getByText('not a sign-in').waitFor();
    await page.getByRole('button', { name: 'Disable' }).click();
    await page.getByText('Provider disabled.').waitFor();
    await page.getByRole('button', { name: 'Enable' }).click();
    await page.getByText('Provider enabled.').waitFor();

    // 3. SAML lifecycle: metadata in, service provider values out.
    await page.goto(`${BASE}/admin/auth/sso/new?type=saml`);
    await page.getByLabel('Display name').fill('Initech');
    await page.getByLabel('Provider ID').fill('initech-saml');
    await page.getByLabel('Email domains').fill('initech.test');
    await page.getByLabel('IdP metadata XML').fill(SAML_METADATA);
    await page.getByRole('button', { name: 'Add provider' }).click();
    await page.waitForURL(/\/admin\/auth\/sso\/initech-saml$/);
    assert.match(
        await page.getByTestId('sso-acs-url').textContent(),
        /\/api\/auth\/sso\/saml2\/sp\/acs\/initech-saml$/,
    );
    assert.match(
        await page.getByTestId('sso-entity-id').textContent(),
        /saml2\/sp\/metadata\?providerId=initech-saml$/,
    );
    await page.goto(`${BASE}/admin/auth/sso`);
    await page.getByRole('cell', { name: 'SAML 2.0' }).waitFor();
    await page.getByRole('cell', { name: 'OIDC' }).waitFor();

    // 4. A browser SP-initiated OIDC sign-in by an ordinary user, who lands as a plain user, not an administrator.
    const user = await browser.newContext();
    const userPage = await user.newPage();
    await userPage.goto(`${BASE}/admin`);
    const started = await userPage.evaluate(
        async ({ email }) => {
            const response = await fetch('/api/auth/sign-in/sso', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email, callbackURL: '/admin' }),
            });

            return { status: response.status, url: (await response.json()).url };
        },
        { email: ssoEmail },
    );
    assert.equal(started.status, 200);
    await userPage.goto(started.url);
    await userPage.waitForURL(/\/admin/);
    const me = await userPage.evaluate(async () => (await (await fetch('/api/auth/get-session')).json()).session);
    assert.equal(me.authMethod, 'sso');
    assert.equal(me.ssoProviderId, 'acme-okta');
    await userPage.goto(`${BASE}/admin/auth/sso`);
    assert.ok(!(await userPage.content()).includes('Acme Okta'), 'An SSO user cannot see provider configuration.');

    // 5. Disabling blocks new sign-ins; deletion needs the typed confirmation and keeps the user.
    await page.goto(`${BASE}/admin/auth/sso/acme-okta`);
    await page.getByRole('button', { name: 'Disable' }).click();
    await page.getByText('Provider disabled.').waitFor();
    const blocked = await post('/api/auth/sign-in/sso', { email: ssoEmail, callbackURL: '/admin' });
    assert.equal(blocked.status, 404);
    await page.getByLabel('Type acme-okta to confirm').fill('wrong');
    await page.getByRole('button', { name: 'Delete provider' }).click();
    await page.getByRole('alert').getByText('Type the provider ID to confirm deletion.').waitFor();
    await page.getByLabel('Type acme-okta to confirm').fill('acme-okta');
    await page.getByRole('button', { name: 'Delete provider' }).click();
    await page.waitForURL(/\/admin\/auth\/sso$/);
    assert.equal((await client.orm.public.SsoProvider.where({ providerId: 'acme-okta' }).all()).length, 0);
    assert.equal(
        (await client.orm.public.User.where({ email: ssoEmail }).all()).length,
        1,
        'The user survives deletion.',
    );
    console.log('Real-browser SSO admin lifecycle for OIDC and SAML passed.');
} finally {
    await application.auth.sso.delete('initech-saml').catch(() => {});
    await browser.close();
    await handle?.stopAccepting?.();
    await runtime.stop?.();
    await application.stop?.();
    idp.close();
}
