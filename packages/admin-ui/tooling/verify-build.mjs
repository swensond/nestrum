import assert from 'node:assert/strict';
import { defineAdmin } from '@nestrum/admin';
import { createHonoRuntime } from '@nestrum/hono';
import { z } from 'zod';
import { allow, defineApplication, defineResource, deny } from '../../core/dist/index.js';
import { generateModelSchemas } from '../../zod/dist/index.js';
import { assets } from '../dist/manifest.js';
import { createAdminShell } from '../dist/node/index.js';

let articleEnabled = false;
let backendCalls = 0;
const resources = ['Project', 'Article'].map((model) =>
    defineResource({
        model,
        api: false,
        schemas: {
            create: (schema) => schema.extend({ name: z.string().min(3) }),
            update: (schema) => schema.extend({ name: z.string().min(3).optional() }),
        },
    }),
);
const auth = {
    kind: 'better-auth',
    database: 'default',
    protectedModels: [],
    createApp: () => ({ name: 'test.auth' }),
    initialize: async () => ({
        basePath: '/api/auth',
        handle: async () => new Response(null, { status: 404 }),
        getSession: async (request) => {
            const cookie = request.headers.get('cookie');
            if (
                !['session=staff', 'session=member', 'session=staff-setup', 'session=staff-challenge'].includes(cookie)
            ) {
                return null;
            }
            const now = Date.now();

            return {
                // `staff-setup` has no factor; `staff-challenge` has one but its session predates the last user update.
                user: {
                    id: 'test-user',
                    twoFactorEnabled: cookie !== 'session=staff-setup',
                    updatedAt: new Date(cookie === 'session=staff-challenge' ? now : now - 3_600_000),
                },
                session: {
                    id: 'session',
                    userId: 'test-user',
                    createdAt: new Date(cookie === 'session=staff-challenge' ? now - 60_000 : now - 1_000),
                    expiresAt: new Date(now + 60_000),
                },
            };
        },
        resolveSubject: async (request) => ({
            id: 'test-user',
            staff: ['session=staff', 'session=staff-setup', 'session=staff-challenge'].includes(
                request.headers.get('cookie'),
            ),
        }),
    }),
};
const stores = new Map(
    resources.map((resource) => [resource.model, [{ id: 'record-one', name: `${resource.model} One`, enabled: true }]]),
);
let writesAllowed = true;
let actionsAllowed = true;
let actionCalls = 0;
let writeCalls = 0;
const matches = (row, query) =>
    query.filters.every((filter) =>
        Object.entries(filter).every(
            ([name, condition]) =>
                row[name] === (typeof condition === 'object' && condition !== null ? condition.equals : condition),
        ),
    );
function backend(model) {
    const rows = stores.get(model);
    return {
        raw: {},
        all: async (query) => {
            backendCalls += 1;
            let selected = rows.filter((row) => matches(row, query));
            for (const order of [...query.orderBy].reverse()) {
                selected = selected.toSorted(
                    (a, b) =>
                        String(a[order.field]).localeCompare(String(b[order.field])) *
                        (order.direction === 'desc' ? -1 : 1),
                );
            }
            return selected.slice(0, query.limit ?? selected.length).map((row) => ({ ...row }));
        },
        count: async () => rows.length,
        create: async (data) => {
            writeCalls += 1;
            const row = { id: data.name === 'Reserved key' ? 'new' : `created-${writeCalls}`, ...data };
            rows.push(row);
            return { ...row };
        },
        update: async (query, data) => {
            writeCalls += 1;
            const selected = rows.filter((row) => matches(row, query));
            for (const row of selected) {
                Object.assign(row, data);
            }
            return selected.length;
        },
        delete: async (query) => {
            writeCalls += 1;
            const selected = rows.filter((row) => matches(row, query));
            for (const row of selected) {
                rows.splice(rows.indexOf(row), 1);
            }
            return selected.length;
        },
    };
}
function createApplication() {
    const admin = defineAdmin();
    for (const resource of resources) {
        admin.register(resource, {
            listDisplay: ['id', 'name', 'enabled'],
            fields: { name: { widget: process.env.NESTRUM_ADMIN_COMPONENTS ? 'json-editor' : 'textarea' } },
            actions: {
                archive: {
                    label: 'Archive',
                    input: z.object({}).strict(),
                    handler: async ({ objects }) => {
                        actionCalls += 1;
                        await objects.update({ enabled: false });
                    },
                },
            },
        });
    }

    return defineApplication({
        apps: [],
        databases: { default: { kind: 'prisma', provider: 'postgresql', connection: 'unused' } },
        auth,
        admin,
        resources,
        resourceModels: resources.map((resource) => ({
            ...generateModelSchemas({
                database: 'default',
                name: resource.model,
                identity: resource.identity,
                namespace: 'public',
                provider: 'postgresql',
                relations: [],
                fields: [
                    {
                        name: 'id',
                        kind: 'string',
                        codec: 'pg/text@1',
                        primaryKey: true,
                        nullable: false,
                        optional: false,
                        array: false,
                        hasCreateDefault: true,
                        hasUpdateDefault: false,
                    },
                    {
                        name: 'name',
                        kind: 'string',
                        codec: 'pg/text@1',
                        primaryKey: false,
                        nullable: false,
                        optional: false,
                        array: false,
                        hasCreateDefault: false,
                        hasUpdateDefault: false,
                    },
                    {
                        name: 'enabled',
                        kind: 'boolean',
                        codec: 'pg/bool@1',
                        primaryKey: false,
                        nullable: false,
                        optional: false,
                        array: false,
                        hasCreateDefault: false,
                        hasUpdateDefault: false,
                    },
                ],
            }),
            queryBackend: backend(resource.model),
        })),
        policies: [
            {
                resource: 'admin.access',
                actions: { access: { authorize: ({ subject }) => (subject.staff ? allow() : deny('NOT_STAFF')) } },
            },
            ...resources.map((resource) => ({
                resource: resource.identity,
                actions: {
                    read: {
                        authorize: () =>
                            resource.model !== 'Article' || articleEnabled ? allow() : deny('ARTICLE_DENIED'),
                    },
                    create: {
                        authorize: () =>
                            (resource.model !== 'Article' || articleEnabled) && writesAllowed
                                ? allow()
                                : deny('WRITE_DENIED'),
                    },
                    update: {
                        authorize: () =>
                            (resource.model !== 'Article' || articleEnabled) && writesAllowed
                                ? allow()
                                : deny('WRITE_DENIED'),
                    },
                    archive: {
                        operations: ['update'],
                        authorize: () => (actionsAllowed ? allow() : deny('ACTION_DENIED')),
                    },
                    delete: {
                        authorize: () =>
                            (resource.model !== 'Article' || articleEnabled) && writesAllowed
                                ? allow()
                                : deny('WRITE_DENIED'),
                    },
                },
            })),
        ],
    });
}
const shell = await createAdminShell();
for (const path of ['/admin', '/admin/*', '/*']) {
    const conflicting = createHonoRuntime({ application: createApplication(), adminUi: shell });
    conflicting.hono.get(path, () => new Response('conflict'));
    await assert.rejects(conflicting.start(), {
        code: path === '/*' ? 'ADMIN_ROUTE_CONFLICT' : 'ADMIN_UI_ROUTE_CONFLICT',
    });
    assert.equal(conflicting.state, 'failed');
    await conflicting.shutdown();
}
const runtime = createHonoRuntime({ application: createApplication(), adminUi: shell, onError: () => {} });
const request = async (path, cookie = 'session=staff', headers = {}, method = 'GET') => {
    const response = await runtime.fetch(
        new Request(`http://localhost:3000${path}`, {
            method,
            headers: { ...headers, ...(cookie ? { cookie } : {}) },
        }),
    );
    if (response.status === 308) {
        assert.equal(response.headers.get('location'), '/admin/');
        return request('/admin/', cookie, headers, method);
    }

    return response;
};

try {
    assert.equal((await request('/admin')).status, 503);
    await runtime.start();
    const initial = await request('/admin');
    const one = await initial.text();
    assert.equal(initial.status, 200);
    assert.equal(initial.headers.get('cache-control'), 'private, no-store');
    assert.ok(one.includes('href="/admin/projects"'));
    assert.ok(!one.includes('href="/admin/articles"'));
    articleEnabled = true;
    const two = await (await request('/admin')).text();
    assert.ok(two.includes('href="/admin/articles"'));
    for (const path of ['/admin/projects', '/admin/projects/new', '/admin/projects/record-one']) {
        const response = await request(path);
        assert.equal(response.status, 200, path);
        assert.ok((await response.text()).includes('Project'));
    }
    assert.equal((await request('/admin/missing')).status, 404);
    const data = await request('/admin/projects/__data.json');
    assert.equal(data.status, 200);
    assert.equal(data.headers.get('cache-control'), 'private, no-store');
    for (const cookie of ['', 'session=expired', 'session=forged']) {
        const response = await request('/admin/projects/new', cookie);
        const html = await response.text();
        assert.ok(html.includes('Sign in'));
        assert.ok(!html.includes('href="/admin/projects"'));
    }
    // Admin 2FA boundary in the compiled shell: browser navigation redirects, API calls get structured JSON errors.
    for (const [cookie, page] of [
        ['session=staff-setup', '/admin/auth/2fa/setup'],
        ['session=staff-challenge', '/admin/auth/2fa'],
    ]) {
        const gate = await runtime.fetch(
            new Request('http://localhost:3000/admin/projects?limit=50', { headers: { cookie } }),
        );
        assert.equal(gate.status, 303, cookie);
        assert.equal(gate.headers.get('location'), `${page}?next=%2Fadmin%2Fprojects%3Flimit%3D50`);
        assert.ok(!(await gate.text()).includes('Project One'));
        const api = await request('/__admin/resources', cookie);
        assert.equal(api.status, 403);
        assert.equal((await api.json()).error.code, 'ADMIN_2FA_REQUIRED');
    }
    const challengePage = await request('/admin/auth/2fa?next=%2Fadmin%2Fprojects', 'session=staff-challenge');
    assert.equal(challengePage.status, 200);
    assert.equal(challengePage.headers.get('cache-control'), 'private, no-store');
    const challengeHtml = await challengePage.text();
    assert.ok(challengeHtml.includes('Sign in again'));
    assert.ok(!challengeHtml.includes('one-time-code'));
    assert.ok(!challengeHtml.includes('href="/admin/projects"'));
    const setupPage = await (await request('/admin/auth/2fa/setup', 'session=staff-setup')).text();
    assert.ok(setupPage.includes('Begin setup'));
    assert.ok(setupPage.includes('type="password"'));
    const denied = await (await request('/admin', 'session=member')).text();
    assert.ok(denied.includes('Access denied'));
    assert.ok(!denied.includes('href="/admin/projects"'));
    const foreign = await (await request('/admin', 'session=staff', { origin: 'https://evil.example' })).text();
    assert.ok(foreign.includes('Access denied'));
    assert.ok(!foreign.includes('href="/admin/projects"'));
    const [signedIn, anonymous] = await Promise.all([request('/admin'), request('/admin', '')]);
    assert.ok((await signedIn.text()).includes('href="/admin/articles"'));
    assert.ok(!(await anonymous.text()).includes('href="/admin/articles"'));
    const asset = assets.find((file) => file.startsWith('_app/immutable/') && file.endsWith('.js'));
    assert.ok(asset);
    const staticResponse = await request(`/admin/${asset}`, '');
    assert.equal(staticResponse.status, 200);
    assert.ok(staticResponse.headers.get('content-type').startsWith('text/javascript'));
    assert.ok(staticResponse.headers.get('cache-control').includes('immutable'));
    assert.equal(await (await request(`/admin/${asset}`, '', {}, 'HEAD')).text(), '');
    assert.equal((await request('/admin/%2e%2e%2fmanifest.js')).status, 404);
    assert.ok(backendCalls > 0, 'Generic lists and detail routes must load private records.');
    assert.ok((await (await request('/admin/projects')).text()).includes('Project One'));
    const submit = (path, data, cookie = 'session=staff', origin = 'http://localhost:3000') =>
        runtime.fetch(
            new Request(`http://localhost:3000${path}`, {
                method: 'POST',
                headers: { cookie, origin, accept: 'text/html' },
                body: new URLSearchParams(data),
            }),
        );
    const invalid = await submit('/admin/projects/new?/create', { name: 'x', enabled: 'false' });
    assert.equal(invalid.status, 400);
    const invalidHtml = await invalid.text();
    assert.ok(/<textarea[^>]*>x<\/textarea>/.test(invalidHtml));
    assert.ok(invalidHtml.includes('aria-invalid="true"'));
    assert.equal(writeCalls, 0);
    const created = await submit('/admin/projects/new?/create', { name: 'New project', enabled: 'false' });
    assert.equal(created.status, 303);
    assert.equal(created.headers.get('location'), '/admin/projects/created-1?saved=create');
    assert.ok((await (await request('/admin/projects/created-1')).text()).includes('New project'));
    const edited = await submit('/admin/projects/created-1?/update', {
        name: 'Edited project',
        'mode:name': 'value',
        'mode:enabled': 'omit',
    });
    assert.equal(edited.status, 303);
    assert.equal(stores.get('Project').find((row) => row.id === 'created-1').enabled, false);
    assert.ok((await (await request('/admin/projects')).text()).includes('Edited project'));
    assert.equal((await submit('/admin/projects/created-1?/delete', {})).status, 400);
    const deleted = await submit('/admin/projects/created-1?/delete', { confirm: 'yes' });
    assert.equal(deleted.status, 303);
    assert.equal(deleted.headers.get('location'), '/admin/projects?saved=delete');
    assert.equal(
        stores.get('Project').some((row) => row.id === 'created-1'),
        false,
    );
    assert.ok((await (await request('/admin/projects/created-1')).text()).includes('no longer exists'));
    const article = await submit('/admin/articles/new?/create', { name: 'Second resource', enabled: 'true' });
    assert.equal(article.status, 303);
    assert.ok((await (await request('/admin/articles')).text()).includes('Second resource'));
    const reserved = await submit('/admin/projects/new?/create', { name: 'Reserved key', enabled: 'true' });
    assert.equal(reserved.headers.get('location'), '/admin/projects/~new?saved=create');
    assert.ok((await (await request('/admin/projects/~new')).text()).includes('Reserved key'));
    assert.equal(
        (await submit('/admin/projects/~new?/update', { name: 'Reserved edited', 'mode:enabled': 'omit' })).status,
        303,
    );
    assert.equal(stores.get('Project').find((row) => row.id === 'new').name, 'Reserved edited');
    assert.equal((await submit('/admin/projects/~new?/delete', { confirm: 'yes' })).status, 303);
    assert.equal(
        stores.get('Project').some((row) => row.id === 'new'),
        false,
    );
    assert.ok((await (await request('/admin/projects/record-one')).text()).includes('Record actions'));
    const action = await submit('/admin/projects/record-one?/action', { action: 'archive', input: '{}' });
    assert.equal(action.status, 303);
    assert.equal(action.headers.get('location'), '/admin/projects/record-one?saved=action');
    assert.equal(stores.get('Project').find((row) => row.id === 'record-one').enabled, false);
    assert.equal(actionCalls, 1);
    assert.equal((await submit('/admin/projects/record-one?/action', { action: 'archive', input: '[]' })).status, 400);
    assert.equal((await submit('/admin/projects/record-one?/action', { action: 'unknown', input: '{}' })).status, 403);
    for (const cookie of ['', 'session=expired', 'session=member']) {
        assert.ok(
            [401, 403].includes(
                (await submit('/admin/projects/record-one?/action', { action: 'archive', input: '{}' }, cookie)).status,
            ),
        );
    }
    assert.equal(
        (
            await submit(
                '/admin/projects/record-one?/action',
                { action: 'archive', input: '{}' },
                'session=staff',
                'https://evil.example',
            )
        ).status,
        403,
    );
    actionsAllowed = false;
    assert.ok(!(await (await request('/admin/projects/record-one')).text()).includes('Record actions'));
    assert.equal((await submit('/admin/projects/record-one?/action', { action: 'archive', input: '{}' })).status, 403);
    assert.equal(actionCalls, 1);
    if (process.env.NESTRUM_ADMIN_COMPONENTS) {
        assert.ok((await (await request('/admin/projects/new')).text()).includes('data-custom-widget="json-editor"'));
    }
    const beforeDenied = writeCalls;
    for (const cookie of ['', 'session=expired', 'session=member']) {
        assert.ok(
            [401, 403].includes(
                (await submit('/admin/projects/new?/create', { name: 'Denied', enabled: 'true' }, cookie)).status,
            ),
        );
    }
    assert.equal(
        (
            await submit(
                '/admin/projects/new?/create',
                { name: 'Denied', enabled: 'true' },
                'session=staff',
                'https://evil.example',
            )
        ).status,
        403,
    );
    writesAllowed = false;
    assert.equal(
        (await submit('/admin/projects/record-one?/update', { name: 'Denied', 'mode:enabled': 'omit' })).status,
        403,
    );
    assert.equal((await submit('/admin/projects/record-one?/delete', { confirm: 'yes' })).status, 403);
    assert.equal(writeCalls, beforeDenied);
    assert.equal((await request('/api/projects')).status, 404);
    console.log(
        'Prebuilt admin UI: generic CRUD, custom actions/widgets, validation, permissions, routes, sessions, SSR isolation and static assets passed.',
    );
} finally {
    await runtime.shutdown();
}
