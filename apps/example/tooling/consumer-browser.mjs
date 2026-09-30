// Real-browser checks of the hosted consumer UI (Post-MVP Plan 04): load, public config, deep links, framework
// namespace separation, the same-origin public API client, and Better Auth sign-in/sign-out from the Svelte app.
//
// Called by `integration.mjs` against the built and served example; it can also be run alone against a running
// server: `CONSUMER_URL=http://127.0.0.1:3100 CONSUMER_EMAIL=... CONSUMER_PASSWORD=... node tooling/consumer-browser.mjs`.
//   PLAYWRIGHT_CHROMIUM   optional Chromium executable path (defaults to Playwright's own)
// Without CONSUMER_EMAIL the sign-in section is skipped (used for database-free verification).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const { chromium } = createRequire(`${import.meta.dirname}/`)('playwright');

export async function runConsumerBrowserChecks({ baseURL, email, password }) {
    const browser = await chromium.launch({
        ...(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}),
        args: ['--no-sandbox'],
    });
    try {
        const context = await browser.newContext();
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));

        // 1. The consumer app loads at / and receives only the allowlisted public config.
        await page.goto(`${baseURL}/`);
        await page.getByRole('heading', { name: 'Example consumer app' }).waitFor();
        assert.equal(await page.locator('#site').textContent(), 'site: nestrum-example');
        const html = await (await context.request.get(`${baseURL}/`)).text();
        assert.ok(html.includes('id="__nestrum_config__"'));
        // The example renders on the server: the raw response already contains the app, not an empty container.
        assert.ok(html.includes('site: nestrum-example'), 'Expected server-rendered markup in the HTML response.');
        for (const secret of [process.env.AUTH_SECRET, process.env.INTEGRATION_IDENTITY_URL].filter(Boolean)) {
            assert.ok(!html.includes(secret), 'Server-only values must not reach the page.');
        }
        console.log('consumer browser load and public config ok');

        // 2. Deep links serve the app; hashed assets are immutable; missing assets are not HTML.
        await page.goto(`${baseURL}/projects/42/edit`);
        await page.getByRole('heading', { name: 'Example consumer app' }).waitFor();
        const asset = /\/assets\/[^"']+\.js/.exec(html)?.[0];
        assert.ok(asset);
        assert.match((await context.request.get(`${baseURL}${asset}`)).headers()['cache-control'], /immutable/);
        assert.equal((await context.request.get(`${baseURL}/assets/missing.js`)).status(), 404);
        console.log('consumer browser deep links and assets ok');

        // 3. Framework namespaces are never shadowed by the SPA fallback, even for browser navigations.
        // The private admin API authenticates before routing, so an anonymous browser sees 401 there, not 404.
        const expected = { '/api/nothing': [404], '/__admin/nothing': [401, 404], '/__nestrum/nothing': [404] };
        for (const [path, statuses] of Object.entries(expected)) {
            const response = await page.goto(`${baseURL}${path}`);
            assert.ok(statuses.includes(response.status()), `${path} returned ${response.status()}`);
            assert.match(response.headers()['content-type'], /json/, path);
        }
        const health = await context.request.get(`${baseURL}/__nestrum/health`);
        assert.equal(health.status(), 200);
        console.log('consumer browser reserved namespaces ok');

        // 4. The public API client reaches the same-origin API.
        await page.goto(`${baseURL}/`);
        await page.getByRole('button', { name: 'Ping public API' }).click();
        await page.getByText('API: ok').waitFor();
        console.log('consumer browser public API client ok');

        // 5. The admin is a separate, protected surface: anonymous browsers cannot read its private API.
        assert.equal((await context.request.get(`${baseURL}/__admin/resources`)).status(), 401);
        await page.goto(`${baseURL}/admin/`);
        assert.equal(await page.getByRole('heading', { name: 'Example consumer app' }).count(), 0);
        console.log('consumer browser admin separation ok');

        // 6. Better Auth sign-in/sign-out through the Svelte helpers, with the session cookie in the browser.
        if (email) {
            await page.goto(`${baseURL}/`);
            await page.getByPlaceholder('Email').fill(email);
            await page.getByPlaceholder('Password').fill('wrong-password');
            await page.getByRole('button', { name: 'Sign in' }).click();
            await page.getByRole('alert').waitFor();
            await page.getByPlaceholder('Password').fill(password);
            await page.getByRole('button', { name: 'Sign in' }).click();
            await page.locator('#who').getByText(`Signed in as ${email}`).waitFor();
            await page.reload();
            await page.locator('#who').waitFor();
            await page.getByRole('button', { name: 'Sign out' }).click();
            await page.getByRole('button', { name: 'Sign in' }).waitFor();
            console.log('consumer browser sign-in and sign-out ok');
        }
        assert.deepEqual(errors, [], `Unexpected page errors: ${errors.join('; ')}`);
    } finally {
        await browser.close();
    }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    await runConsumerBrowserChecks({
        baseURL: process.env.CONSUMER_URL ?? 'http://127.0.0.1:3100',
        email: process.env.CONSUMER_EMAIL,
        password: process.env.CONSUMER_PASSWORD,
    });
    console.log('ALL CONSUMER BROWSER CHECKS PASSED');
}
