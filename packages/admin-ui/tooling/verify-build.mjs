import assert from 'node:assert/strict';
import { defineAdmin } from '@nestrum/admin';
import { createHonoRuntime } from '@nestrum/hono';
import { allow, defineApplication, defineResource, deny } from '../../core/dist/index.js';
import { generateModelSchemas } from '../../zod/dist/index.js';
import { assets } from '../dist/manifest.js';
import { createAdminShell } from '../dist/node/index.js';

let articleEnabled = false;
let backendCalls = 0;
const resources = ['Project', 'Article'].map((model) => defineResource({ model, api: false }));
const auth = {
    kind: 'better-auth',
    database: 'default',
    protectedModels: [],
    createApp: () => ({ name: 'test.auth' }),
    initialize: async () => ({
        basePath: '/api/auth',
        handle: async () => new Response(null, { status: 404 }),
        getSession: async (request) =>
            ['session=staff', 'session=member'].includes(request.headers.get('cookie'))
                ? {
                      user: { id: 'test-user' },
                      session: { id: 'session', userId: 'test-user', expiresAt: new Date(Date.now() + 60_000) },
                  }
                : null,
        resolveSubject: async (request) => ({
            id: 'test-user',
            staff: request.headers.get('cookie') === 'session=staff',
        }),
    }),
};
const backend = {
    raw: {},
    all: async () => {
        backendCalls += 1;
        return [];
    },
    count: async () => {
        backendCalls += 1;
        return 0;
    },
    create: async () => {
        backendCalls += 1;
        return {};
    },
    update: async () => {
        backendCalls += 1;
        return 0;
    },
    delete: async () => {
        backendCalls += 1;
        return 0;
    },
};
function createApplication() {
    const admin = defineAdmin();
    for (const resource of resources) {
        admin.register(resource, { listDisplay: ['id'] });
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
                ],
            }),
            queryBackend: backend,
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
                            resource.model !== 'Article' || articleEnabled ? allow() : deny('ARTICLE_DENIED'),
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
    assert.equal(backendCalls, 0, 'Shell routes must not execute CRUD.');
    console.log('Prebuilt admin UI: routes, navigation, sessions, SSR isolation and static assets passed.');
} finally {
    await runtime.shutdown();
}
