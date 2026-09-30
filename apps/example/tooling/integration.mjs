import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { totpCode, totpSecretFromUri, totpStep } from '@nestrum/auth';
import { runServe } from '@nestrum/cli';

const ROOT_DIR = fileURLToPath(new URL('../', import.meta.url));
const execute = promisify(execFile);
const project = `nestrum-integration-${process.pid}`;
const runDir = `.nestrum/integration-${process.pid}`;
const compose = ['compose', '-p', project, '-f', join(ROOT_DIR, 'compose.yaml')];
const freePort = async () => {
    const probe = createServer();
    await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const { port } = probe.address();
    await new Promise((resolve) => probe.close(resolve));
    return port;
};
const docker = async (args) =>
    (await execute('docker', [...compose, ...args], { timeout: 90_000, maxBuffer: 1024 * 1024 })).stdout;
let server;

try {
    console.log('Starting dedicated Docker PostgreSQL and MongoDB services.');
    await docker(['up', '--wait', '--wait-timeout', '60']);
    const port = await freePort();
    const baseURL = `http://127.0.0.1:${port}`;
    const postgresAddress = (await docker(['port', 'postgres', '5432'])).trim();
    const mongoAddress = (await docker(['port', 'mongo', '27017'])).trim();
    const connections = {
        default: `postgresql://nestrum:integration-only@${postgresAddress}/nestrum_integration`,
        identity: `postgresql://nestrum:integration-only@${postgresAddress}/nestrum_identity`,
        documents: `mongodb://${mongoAddress}/nestrum_integration`,
    };
    const secret = 'ephemeral-integration-secret-with-at-least-32-characters';
    const env = {
        ...process.env,
        INTEGRATION_POSTGRES_URL: connections.default,
        INTEGRATION_IDENTITY_URL: connections.identity,
        INTEGRATION_MONGO_URL: connections.documents,
        INTEGRATION_OUTPUT_DIR: `${runDir}/db-contracts`,
        INTEGRATION_MIGRATIONS_DIR: `${runDir}/migrations`,
        AUTH_SECRET: secret,
        PORT: String(port),
        BASE_URL: baseURL,
    };
    Object.assign(process.env, env);
    const cli = async (args) =>
        (
            await execute(
                process.execPath,
                [
                    resolve(ROOT_DIR, '../../packages/cli/dist/bin.js'),
                    'db',
                    ...args,
                    '--config',
                    join(ROOT_DIR, 'nestrum.config.mjs'),
                ],
                { env, cwd: ROOT_DIR, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
            )
        ).stdout;
    for (const database of ['default', 'documents', 'identity']) {
        const generated = JSON.parse(await cli(['generate', '--database', database, '--json']));
        const contract = JSON.parse(await readFile(generated.contract, 'utf8'));
        assert.equal(contract.target, database === 'documents' ? 'mongo' : 'postgres');
        const types = await readFile(generated.types, 'utf8');
        assert.ok(!types.includes('@internal/'), 'Generated types must use public installed provider imports.');
        await cli(['migrate', '--database', database, '--plan', '--name', 'initial', '--json']);
        await cli(['migrate', '--database', database, '--json']);
        const status = await cli(['status', '--database', database, '--json']);
        assert.ok(status.includes('"ok":true'), `${database} migration status must succeed.`);
        console.log(`Real ${database} generation, migration application and status passed.`);
    }

    // The framework owns the lifecycle: build, then serve the built application (no application HTTP bootstrap).
    await execute(
        process.execPath,
        [resolve(ROOT_DIR, '../../packages/cli/dist/bin.js'), 'build', '--config', 'nestrum.config.mjs'],
        {
            env,
            cwd: ROOT_DIR,
            timeout: 120_000,
            maxBuffer: 4 * 1024 * 1024,
        },
    );
    // The first administrator comes from the CLI (against the build), never from signup.
    await execute(
        process.execPath,
        [
            resolve(ROOT_DIR, '../../packages/cli/dist/bin.js'),
            'auth',
            'create-admin',
            '--email',
            'staff@example.test',
            '--name',
            'Staff',
            '--config',
            'nestrum.config.mjs',
        ],
        {
            env: { ...env, NESTRUM_ADMIN_PASSWORD: 'Integration-password-2026!' },
            cwd: ROOT_DIR,
            timeout: 120_000,
            maxBuffer: 4 * 1024 * 1024,
        },
    );
    server = await runServe({ cwd: ROOT_DIR, config: 'nestrum.config.mjs', flags: { port }, env: process.env });
    // runServe loaded the built module; importing the same file yields the same instance and its exported handles.
    const { example } = await import(pathToFileURL(join(ROOT_DIR, '.nestrum/server/index.mjs')).href);
    const events = example.events;
    const host = { baseURL };
    const runtime = server.runtime;
    assert.deepEqual(
        example.application.apps.all().map((app) => app.name),
        ['nestrum.auth', 'projects', 'articles'],
    );
    assert.equal(example.application.databases.get('identity').provider, 'postgresql');
    assert.deepEqual(
        example.application.resources.all().map((resource) => resource.identity),
        ['default.Project', 'documents.Article'],
    );
    assert.equal(
        example.application.resources
            .get('default.Project')
            .schemas.create.safeParse({ id: 'bad', name: 'x', ownerId: 'bad', status: 'active' }).success,
        false,
    );
    assert.equal(
        example.application.resources
            .get('documents.Article')
            .schemas.create.safeParse({ id: 'bad', title: 'x', ownerId: 'bad', status: 'draft' }).success,
        false,
    );

    const request = async (path, { method = 'GET', body, cookie = '', origin = host.baseURL, form } = {}) =>
        fetch(`${host.baseURL}${path}`, {
            method,
            redirect: 'manual',
            headers: {
                ...(cookie ? { cookie } : {}),
                origin,
                ...(form ? { accept: 'text/html' } : {}),
                ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            },
            ...(form ? { body: new URLSearchParams(form) } : body === undefined ? {} : { body: JSON.stringify(body) }),
        });
    const json = async (response, status) => {
        const data = await response.json();
        assert.equal(response.status, status, JSON.stringify(data));
        return data;
    };
    const credentials = (email) => ({ name: email.split('@')[0], email, password: 'Integration-password-2026!' });
    // Public signup can never assign a role, and administrators come only from the CLI.
    assert.equal(
        (
            await request('/api/auth/sign-up/email', {
                method: 'POST',
                body: { ...credentials('sneaky@example.test'), role: 'admin' },
            })
        ).status,
        400,
    );
    const signin = await request('/api/auth/sign-in/email', {
        method: 'POST',
        body: credentials('staff@example.test'),
    });
    const staff = await json(signin, 200);
    assert.equal(staff.user.role, 'admin');
    let cookie = signin.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; ');
    assert.ok(cookie);
    await json(
        await request('/api/auth/sign-up/email', { method: 'POST', body: credentials('member@example.test') }),
        200,
    );
    const memberSignin = await request('/api/auth/sign-in/email', {
        method: 'POST',
        body: credentials('member@example.test'),
    });
    const member = await json(memberSignin, 200);
    const memberCookie = memberSignin.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; ');
    assert.equal((await request('/__admin/resources')).status, 401);
    assert.equal((await request('/__admin/resources', { cookie: memberCookie })).status, 403);
    assert.equal((await request('/__admin/resources', { cookie, origin: 'https://foreign.invalid' })).status, 403);
    // Admin 2FA is required by default: a valid login and admin.access are not enough until a second factor is set up.
    const setupRequired = await json(await request('/__admin/resources', { cookie }), 403);
    assert.equal(setupRequired.error.code, 'ADMIN_2FA_REQUIRED');
    assert.equal(setupRequired.error.reason, 'setup-required');
    const navigate = (path, sessionCookie) =>
        fetch(`${host.baseURL}${path}`, {
            redirect: 'manual',
            headers: { cookie: sessionCookie, accept: 'text/html' },
        });
    const setupRedirect = await navigate('/admin/projects', cookie);
    assert.equal(setupRedirect.status, 303);
    assert.equal(setupRedirect.headers.get('location'), '/admin/auth/2fa/setup?next=%2Fadmin%2Fprojects');
    assert.equal((await navigate('/admin/auth/2fa/setup', cookie)).status, 200);
    const cookieFrom = (response) =>
        response.headers
            .getSetCookie()
            .filter((value) => !/=;|Max-Age=0/i.test(value))
            .map((value) => value.split(';')[0])
            .join('; ');
    // Better Auth's twoFactor plugin owns enrollment: enable (password), then verify a TOTP to activate.
    const preEnrollment = cookie;
    const enrollment = await json(
        await request('/api/auth/two-factor/enable', {
            method: 'POST',
            cookie,
            body: { password: credentials('staff@example.test').password },
        }),
        200,
    );
    assert.equal(
        (await request('/__admin/resources', { cookie })).status,
        403,
        'An unconfirmed secret grants nothing.',
    );
    assert.equal(
        (await request('/api/auth/two-factor/verify-totp', { method: 'POST', cookie, body: { code: '000000' } }))
            .status,
        401,
    );
    const totpSecret = totpSecretFromUri(enrollment.totpURI);
    const activated = await request('/api/auth/two-factor/verify-totp', {
        method: 'POST',
        cookie,
        body: { code: totpCode(totpSecret, totpStep(Date.now())) },
    });
    await json(activated, 200);
    cookie = cookieFrom(activated);
    assert.equal((await request('/__admin/resources', { cookie })).status, 200);
    // Activation replaced the enrolling session, so the pre-enrollment cookie is dead.
    assert.equal((await request('/__admin/resources', { cookie: preEnrollment })).status, 401);
    // Signing in now yields no session until a code is verified.
    const signInPending = async () => {
        const response = await request('/api/auth/sign-in/email', {
            method: 'POST',
            body: credentials('staff@example.test'),
        });
        assert.equal((await json(response, 200)).twoFactorRedirect, true);
        return cookieFrom(response);
    };
    const pending = await signInPending();
    assert.equal((await request('/__admin/resources', { cookie: pending })).status, 401);
    // A pending sign-in has no session, so the browser gets the sign-in shell (no redirect, no admin data).
    const pendingPage = await navigate('/admin/projects', pending);
    assert.equal(pendingPage.status, 200);
    const pendingHtml = await pendingPage.text();
    assert.ok(pendingHtml.includes('Sign in'));
    assert.ok(!pendingHtml.includes('href="/admin/projects"'));
    const backupCodes = enrollment.backupCodes;
    assert.ok(backupCodes.length > 0);
    const viaBackup = await request('/api/auth/two-factor/verify-backup-code', {
        method: 'POST',
        cookie: pending,
        body: { code: backupCodes[0] },
    });
    await json(viaBackup, 200);
    assert.equal((await request('/__admin/resources', { cookie: cookieFrom(viaBackup) })).status, 200);
    assert.equal(
        (
            await request('/api/auth/two-factor/verify-backup-code', {
                method: 'POST',
                cookie: await signInPending(),
                body: { code: backupCodes[0] },
            })
        ).status,
        401,
        'A backup code works once.',
    );
    console.log('Real admin 2FA enrollment, challenge, recovery and redirects passed.');
    // Staff management: an administrator elevates a user to staff in the admin API; nothing is configured by id.
    const asJson = (path, sessionCookie, method = 'GET', body) =>
        request(path, { method, cookie: sessionCookie, ...(body === undefined ? {} : { body }) });
    const elevated = await json(
        await request('/api/auth/sign-up/email', { method: 'POST', body: credentials('elevate@example.test') }),
        200,
    );
    assert.deepEqual(await json(await asJson('/__admin/access/capabilities', cookie), 200), { users: true });
    const found = await json(await asJson('/__admin/access/users?email=elevate%40example.test', cookie), 200);
    assert.equal(found.users[0].id, elevated.user.id);
    assert.equal(found.users[0].role, 'user');
    assert.equal(
        (await asJson(`/__admin/access/users/${elevated.user.id}/role`, cookie, 'POST', { role: 'admin' })).status,
        400,
        'The interface cannot create administrators.',
    );
    await json(await asJson(`/__admin/access/users/${elevated.user.id}/role`, cookie, 'POST', { role: 'staff' }), 200);
    const elevatedLogin = await request('/api/auth/sign-in/email', {
        method: 'POST',
        body: credentials('elevate@example.test'),
    });
    await json(elevatedLogin, 200);
    let elevatedCookie = cookieFrom(elevatedLogin);
    assert.equal((await asJson('/__admin/resources', elevatedCookie)).status, 403, 'New staff still need 2FA.');
    const elevatedEnrollment = await json(
        await request('/api/auth/two-factor/enable', {
            method: 'POST',
            cookie: elevatedCookie,
            body: { password: credentials('elevate@example.test').password },
        }),
        200,
    );
    const elevatedActivation = await request('/api/auth/two-factor/verify-totp', {
        method: 'POST',
        cookie: elevatedCookie,
        body: { code: totpCode(totpSecretFromUri(elevatedEnrollment.totpURI), totpStep(Date.now())) },
    });
    await json(elevatedActivation, 200);
    elevatedCookie = cookieFrom(elevatedActivation);
    assert.equal((await asJson('/__admin/resources', elevatedCookie)).status, 200);
    assert.deepEqual(await json(await asJson('/__admin/access/capabilities', elevatedCookie), 200), { users: false });
    assert.equal((await asJson('/__admin/access/users', elevatedCookie)).status, 403, 'Staff cannot manage users.');
    assert.equal(
        (await navigate('/admin/access', elevatedCookie)).status,
        200,
        'The page renders and reports the missing permission.',
    );
    const usersPage = await (await navigate('/admin/access', cookie)).text();
    assert.ok(usersPage.includes('elevate@example.test'));
    assert.ok(usersPage.includes('Remove staff access'));
    await json(await asJson(`/__admin/access/users/${elevated.user.id}/role`, cookie, 'POST', { role: 'user' }), 200);
    assert.equal((await asJson('/__admin/resources', elevatedCookie)).status, 403, 'Demotion revokes admin access.');
    console.log('Real CLI administrator creation and staff elevation through the admin API passed.');
    const metadata = await json(await request('/__admin/resources', { cookie }), 200);
    assert.deepEqual(
        metadata.map((resource) => resource.identity),
        ['default.Project', 'documents.Article'],
    );
    assert.ok(metadata.every((resource) => resource.actions.some((action) => action.name === 'archive')));
    const projectData = {
        id: 'project-one',
        name: 'First project',
        description: 'SQL persistence',
        ownerId: staff.user.id,
        status: 'active',
    };
    const articleData = {
        _id: '000000000000000000000001',
        title: 'First article',
        body: 'Mongo persistence',
        ownerId: staff.user.id,
        status: 'published',
    };
    assert.equal((await request('/api/projects')).status, 403);
    await json(await request('/api/projects', { method: 'POST', body: projectData, cookie }), 201);
    await json(await request('/__admin/documents--articles', { method: 'POST', body: articleData, cookie }), 201);
    assert.equal((await request('/api/documents/articles', { cookie })).status, 404);
    assert.equal(
        (
            await request('/api/documents/articles/000000000000000000000001', {
                method: 'PATCH',
                body: { title: 'Hidden' },
                cookie,
            })
        ).status,
        404,
    );
    const openapi = await json(await request('/api/openapi.json', { cookie }), 200);
    assert.ok(Object.keys(openapi.paths).some((path) => path.includes('projects')));
    assert.ok(!JSON.stringify(openapi).includes('articles'));
    assert.equal(
        (await request('/api/projects', { method: 'POST', cookie, body: { ...projectData, id: 'invalid', name: 'x' } }))
            .status,
        400,
    );
    assert.equal(
        (
            await request('/__admin/documents--articles', {
                method: 'POST',
                cookie,
                body: { ...articleData, _id: 'invalid', title: 'x' },
            })
        ).status,
        400,
    );
    assert.equal(
        (
            await request('/api/projects', {
                method: 'POST',
                cookie: memberCookie,
                body: { ...projectData, id: 'forged' },
            })
        ).status,
        403,
    );
    await json(
        await request('/api/projects', {
            method: 'POST',
            cookie: memberCookie,
            body: { ...projectData, id: 'member-owned', ownerId: member.user.id },
        }),
        201,
    );
    const project = example.application.resources.get('default.Project');
    const article = example.application.resources.get('documents.Article');
    const subject = { id: staff.user.id, role: 'admin' };
    assert.equal(await project.managers.active.authorizedFor(subject, 'read').count(), 1);
    assert.equal(await article.managers.published.authorizedFor(subject, 'read').count(), 1);
    assert.equal(
        await article.objects.authorizedFor(subject, 'read').filter({ _id: '000000000000000000000001' }).count(),
        1,
    );
    assert.equal((await json(await request('/api/projects', { cookie }), 200)).length, 1);
    assert.equal((await request('/api/projects/member-owned', { cookie })).status, 404);
    assert.equal(
        (await request('/api/projects/member-owned', { method: 'PATCH', cookie, body: { name: 'Hijacked' } })).status,
        404,
    );
    assert.equal(
        (await request('/api/projects/project-one', { method: 'PATCH', cookie, body: { name: 'Updated SQL' } })).status,
        204,
    );
    assert.equal(
        (
            await request('/__admin/documents--articles/000000000000000000000001', {
                method: 'PATCH',
                cookie,
                body: { title: 'Updated Mongo' },
            })
        ).status,
        204,
    );
    assert.equal((await json(await request('/api/projects/project-one', { cookie }), 200)).name, 'Updated SQL');
    assert.equal(
        (await json(await request('/__admin/documents--articles/000000000000000000000001', { cookie }), 200)).title,
        'Updated Mongo',
    );
    for (const path of [
        '/admin/projects',
        '/admin/documents--articles',
        '/admin/projects/project-one',
        '/admin/documents--articles/000000000000000000000001',
    ]) {
        const response = await request(path, { cookie });
        assert.equal(response.status, 200, path);
        assert.ok((await response.text()).includes(path.includes('articles') ? 'Updated Mongo' : 'Updated SQL'));
    }
    const formCreate = await request('/admin/documents--articles/new?/create', {
        method: 'POST',
        cookie,
        form: { ...articleData, _id: '000000000000000000000002', title: 'Native form article' },
    });
    assert.equal(formCreate.status, 303, await formCreate.text());
    assert.equal(
        (await json(await request('/__admin/documents--articles/000000000000000000000002', { cookie }), 200)).title,
        'Native form article',
    );
    const formUpdate = await request('/admin/documents--articles/000000000000000000000002?/update', {
        method: 'POST',
        cookie,
        form: { title: 'Native form edited', 'mode:title': 'value' },
    });
    assert.equal(formUpdate.status, 303, await formUpdate.text());
    const action = await request('/admin/documents--articles/000000000000000000000002?/action', {
        method: 'POST',
        cookie,
        form: { action: 'archive', input: '{}' },
    });
    assert.equal(action.status, 303, await action.text());
    assert.equal(
        (await json(await request('/__admin/documents--articles/000000000000000000000002', { cookie }), 200)).status,
        'archived',
    );
    const formDelete = await request('/admin/documents--articles/000000000000000000000002?/delete', {
        method: 'POST',
        cookie,
        form: { confirm: 'yes' },
    });
    assert.equal(formDelete.status, 303, await formDelete.text());
    assert.equal((await request('/__admin/documents--articles/000000000000000000000002', { cookie })).status, 404);
    if (process.env.INTEGRATION_BROWSER_QA === '1') {
        console.log(
            `Browser QA: ${host.baseURL}/admin — staff@example.test / Integration-password-2026! — resume with SIGUSR2 to PID ${process.pid}`,
        );
        await new Promise((resolve) => process.once('SIGUSR2', resolve));
    }
    assert.equal(
        (await request('/__admin/projects/project-one/actions/archive', { method: 'POST', cookie, body: {} })).status,
        204,
    );
    assert.equal((await json(await request('/api/projects/project-one', { cookie }), 200)).status, 'archived');
    assert.equal((await request('/api/projects/project-one', { method: 'DELETE', cookie })).status, 204);
    assert.equal(
        (await request('/__admin/documents--articles/000000000000000000000001', { method: 'DELETE', cookie })).status,
        204,
    );
    assert.equal((await request('/api/projects/project-one', { cookie })).status, 404);
    await json(await request('/api/auth/sign-out', { method: 'POST', cookie, body: {} }), 200);
    assert.equal((await request('/__admin/resources', { cookie })).status, 401);
    console.log(
        'Real auth/session ABAC, SQL/public CRUD, Mongo/admin CRUD, managers/scopes, OpenAPI and generic Svelte forms passed.',
    );
    await server.shutdown();
    assert.deepEqual(events.slice(-5), [
        'shutdown:articles',
        'shutdown:projects',
        'disconnect:identity',
        'disconnect:documents',
        'disconnect:default',
    ]);
    assert.equal((await runtime.fetch(new Request(`${host.baseURL}/api/projects`))).status, 503);
    console.log('Reverse app/DI/database shutdown and traffic gating passed.');
} finally {
    try {
        await server?.shutdown();
    } finally {
        await docker(['down', '--volumes', '--remove-orphans']);
        await rm(join(ROOT_DIR, runDir), { recursive: true, force: true });
    }
}
