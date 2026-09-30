// Real-browser check of admin 2FA enrollment, challenge, recovery, return-to and assurance expiry.
//
// Serves an identity-only application (PostgreSQL with the migrated identity contract) with the built admin shell and
// drives it with Playwright. Not part of `pnpm check`: it needs a reachable, migrated identity database and Playwright.
//   INTEGRATION_IDENTITY_URL   PostgreSQL URL of a database migrated with the example identity contract
//   NESTRUM_CONTRACT_JSON      path to that database's generated contract.json
//   PLAYWRIGHT_MODULE_DIR      node_modules directory that resolves `playwright` (default: this package)
//   PLAYWRIGHT_CHROMIUM        optional Chromium executable path
// It waits ~62 seconds so the 60 second assurance TTL can lapse.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { defineAdmin } from '@nestrum/admin';
import { createAdminShell } from '@nestrum/admin-ui/node';
import { defineAuth, field, totpCode, totpStep } from '@nestrum/auth';
import { allow, defineApplication } from '@nestrum/core';
import postgres from '@nestrum/example-postgres';
import { createHonoRuntime } from '@nestrum/hono';
import { nodeRuntime } from '../../../packages/runtime-node/dist/index.js';

const { chromium } = createRequire(`${process.env.PLAYWRIGHT_MODULE_DIR ?? import.meta.dirname}/`)('playwright');
const url = process.env.INTEGRATION_IDENTITY_URL;
const client = postgres({ contractJson: JSON.parse(readFileSync(process.env.NESTRUM_CONTRACT_JSON, 'utf8')), url });
const BASE = 'http://127.0.0.1:3199';
const PASSWORD = 'Local-password-2026!';
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
        extend: { user: { staff: field.boolean().default(false) } },
    }),
    admin: defineAdmin({ security: { twoFactor: { assuranceTtlSeconds: 60 } } }),
    policies: [{ resource: 'admin.access', actions: { access: { authorize: () => allow() } } }],
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
handle = await nodeRuntime.serve(runtime, { host: '127.0.0.1', port: 3199 });
const email = `e2e-${Date.now()}@example.test`;
const up = await fetch(`${BASE}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ name: 'E2E', email, password: PASSWORD }),
});
assert.equal(up.status, 200);

const browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}),
    args: ['--no-sandbox'],
});
async function signIn(page, path) {
    await page.goto(`${BASE}${path}`);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
}
try {
    // 1. Enrollment: sign-in lands on setup with the intended URL preserved.
    const c1 = await browser.newContext();
    const p1 = await c1.newPage();
    await signIn(p1, '/admin/somewhere');
    await p1.waitForURL(/\/admin\/auth\/2fa\/setup\?next=%2Fadmin%2Fsomewhere/);
    await p1.getByRole('button', { name: 'Begin setup' }).click();
    await p1.getByText('Setup key:').waitFor();
    const wrongKey = (await p1.locator('code').first().textContent()).trim();
    await p1.getByLabel('Verification code').fill('000000');
    await p1.getByRole('button', { name: 'Activate' }).click();
    await p1
        .getByRole('alert')
        .getByText(/not valid/)
        .waitFor();
    assert.ok(!(await p1.content()).includes(wrongKey), 'A failed attempt never re-renders the key.');
    await p1.getByRole('button', { name: 'Start over' }).click();
    await p1.getByText('Setup key:').waitFor();
    const secret = (await p1.locator('code').first().textContent()).trim();
    assert.notEqual(secret, wrongKey);
    await p1.getByLabel('Verification code').fill(totpCode(secret, totpStep(Date.now())));
    await p1.getByRole('button', { name: 'Activate' }).click();
    await p1.getByRole('heading', { name: 'Save your recovery codes' }).waitFor();
    const codes = await p1.locator('ul[aria-label="Recovery codes"] code').allTextContents();
    assert.equal(codes.length, 10);
    assert.match(
        await p1
            .locator('meta[http-equiv], body')
            .first()
            .evaluate(() => document.title),
        /two-factor/i,
    );
    await p1.getByRole('link', { name: /continue/ }).click();
    await p1.waitForURL(`${BASE}/admin/somewhere`);
    console.log('browser enrollment ok');
    await p1.goto(`${BASE}/admin`);
    await p1.getByRole('heading', { name: 'Administration' }).waitFor();

    // 2. Challenge in a fresh session returns to the intended route.
    const c2 = await browser.newContext();
    const p2 = await c2.newPage();
    await signIn(p2, '/admin/intended?limit=50');
    await p2.waitForURL(/\/admin\/auth\/2fa\?next=%2Fadmin%2Fintended%3Flimit%3D50/);
    await p2.getByLabel('Verification code').fill('000000');
    await p2.getByRole('button', { name: 'Verify' }).click();
    await p2
        .getByRole('alert')
        .getByText(/not valid/)
        .waitFor();
    // The confirmation code's step is spent; the next step is inside the accepted window.
    await p2.getByLabel('Verification code').fill(totpCode(secret, totpStep(Date.now()) + 1));
    await p2.getByRole('button', { name: 'Verify' }).click();
    await p2.waitForURL(`${BASE}/admin/intended?limit=50`);
    console.log('browser challenge + return-to ok');

    // 3. Recovery path, one-time use.
    const c3 = await browser.newContext();
    const p3 = await c3.newPage();
    await signIn(p3, '/admin/recover');
    await p3.waitForURL(/\/admin\/auth\/2fa\?next=/);
    await p3.getByRole('link', { name: 'Use a recovery code instead' }).click();
    await p3.waitForURL(/\/admin\/auth\/recovery\?next=%2Fadmin%2Frecover/);
    await p3.getByLabel('Recovery code').fill(codes[0]);
    await p3.getByRole('button', { name: 'Verify recovery code' }).click();
    await p3.waitForURL(`${BASE}/admin/recover`);
    const c4 = await browser.newContext();
    const p4 = await c4.newPage();
    await signIn(p4, '/admin/recover');
    await p4.waitForURL(/\/admin\/auth\/2fa\?next=/);
    await p4.goto(`${BASE}/admin/auth/recovery?next=%2Fadmin%2Frecover`);
    await p4.getByLabel('Recovery code').fill(codes[0]);
    await p4.getByRole('button', { name: 'Verify recovery code' }).click();
    await p4
        .getByRole('alert')
        .getByText(/not valid/)
        .waitFor();
    console.log('browser recovery one-time use ok');

    // 4. Open redirect attempts fall back to /admin.
    await p4.goto(`${BASE}/admin/auth/recovery?next=https%3A%2F%2Fevil.example%2F`);
    await p4.getByLabel('Recovery code').fill(codes[1]);
    await p4.getByRole('button', { name: 'Verify recovery code' }).click();
    await p4.waitForURL(`${BASE}/admin/`);
    console.log('browser open-redirect fallback ok');

    // 5. Assurance expiry (TTL 60s) forces a re-challenge while the login session survives.
    console.log('waiting for assurance expiry (62s)...');
    await new Promise((resolve) => setTimeout(resolve, 62_000));
    await p2.goto(`${BASE}/admin/intended`);
    await p2.waitForURL(/\/admin\/auth\/2fa\?next=%2Fadmin%2Fintended/);
    assert.equal((await c2.request.get(`${BASE}/api/auth/get-session`)).status(), 200);
    const api = await c2.request.get(`${BASE}/__admin/resources`);
    assert.equal(api.status(), 403);
    assert.equal((await api.json()).error.reason, 'challenge-required');
    assert.match(api.headers()['content-type'], /json/);
    console.log('browser expiry re-challenge ok');
    console.log('ALL BROWSER CHECKS PASSED');
} finally {
    await browser.close();
    await runtime.shutdown();
}
