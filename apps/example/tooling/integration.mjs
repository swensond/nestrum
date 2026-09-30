import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createAdminShell } from '@nestrum/admin-ui/node';
import { createHonoRuntime } from '@nestrum/hono';
import { createExample, providerDirectory, ROOT_DIR } from '../src/application.mjs';
import { createFetchHost } from '../src/host.mjs';

const execute = promisify(execFile);
const project = `nestrum-integration-${process.pid}`;
const runDir = `.nestrum/integration-${process.pid}`;
const compose = ['compose', '-p', project, '-f', join(ROOT_DIR, 'compose.yaml')];
const docker = async (args) =>
    (await execute('docker', [...compose, ...args], { timeout: 90_000, maxBuffer: 1024 * 1024 })).stdout;
const events = [];
let runtime;
let host;

try {
    console.log('Starting dedicated Docker PostgreSQL and MongoDB services.');
    await docker(['up', '--wait', '--wait-timeout', '60']);
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
        INTEGRATION_OUTPUT_DIR: `${runDir}/contracts`,
        INTEGRATION_MIGRATIONS_DIR: `${runDir}/migrations`,
        AUTH_SECRET: secret,
    };
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

    host = await createFetchHost((request) => (runtime ? runtime.fetch(request) : new Response(null, { status: 503 })));
    const example = createExample({
        connections,
        baseURL: host.baseURL,
        outputDir: `${runDir}/contracts`,
        events,
        secret,
    });
    runtime = createHonoRuntime({
        application: example.application,
        adminUi: await createAdminShell(),
        stopTraffic: () => {
            events.push('stop-traffic');
            host.stop();
        },
        onError: (error) => {
            if (!(error.status >= 400 && error.status < 500) && error.name !== 'ZodError') {
                console.error('Integration runtime error:', error);
            }
        },
    });
    await runtime.start();
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
    const staff = await json(
        await request('/api/auth/sign-up/email', {
            method: 'POST',
            body: { ...credentials('staff@example.test'), staff: true },
        }),
        200,
    );
    assert.equal(staff.user.staff, false, 'Public signup cannot grant staff.');
    await example.clients.get('identity').orm.public.User.where({ id: staff.user.id }).updateAndCount({ staff: true });
    const signin = await request('/api/auth/sign-in/email', {
        method: 'POST',
        body: credentials('staff@example.test'),
    });
    await json(signin, 200);
    const cookie = signin.headers
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
    const subject = { id: staff.user.id, staff: true };
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
    assert.equal(
        (await example.clients.get('identity').orm.public.User.where({ id: staff.user.id }).first()).staff,
        true,
    );
    console.log(
        'Real auth/session ABAC, SQL/public CRUD, Mongo/admin CRUD, managers/scopes, OpenAPI and generic Svelte forms passed.',
    );
    await runtime.shutdown();
    assert.deepEqual(events.slice(-6), [
        'stop-traffic',
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
        await runtime?.shutdown();
    } finally {
        host?.stop();
        await docker(['down', '--volumes', '--remove-orphans']);
        for (const database of ['default', 'documents']) {
            await rm(join(providerDirectory(database), runDir), { recursive: true, force: true });
        }
    }
}
