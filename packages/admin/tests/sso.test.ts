import { defineAuth, totpCode, totpSecretFromUri, totpStep } from '@nestrum/auth';
import type { AuthSession, SsoAuditEvent } from '@nestrum/core';
import { defineApplication } from '@nestrum/core';
import { createHonoRuntime } from '@nestrum/hono';
import { afterAll, describe, expect, it } from 'vitest';
import { storage } from '../../auth/tests/fixtures.js';
import { idpMetadata, startFakeOidc } from '../../auth/tests/sso-fixtures.js';
import { defineAdmin, roleBasedAdminPolicies, sessionAssurance } from '../src/index.js';

const BASE_URL = 'http://localhost:3000';
const PASSWORD = 'a-valid-password-123';
const idps: { close(): Promise<void> }[] = [];
afterAll(async () => {
    await Promise.all(idps.map((idp) => idp.close()));
});

function json(method: string, value?: unknown, cookie?: string, origin = BASE_URL): RequestInit {
    return {
        method,
        headers: {
            ...(value === undefined ? {} : { 'content-type': 'application/json' }),
            origin,
            ...(cookie ? { cookie } : {}),
        },
        ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    };
}
const cookieOf = (response: Response) =>
    response.headers
        .getSetCookie()
        .filter((value) => !/=;|Max-Age=0/i.test(value))
        .map((value) => value.split(';')[0])
        .join('; ');

async function setup(sso = true) {
    const idp = await startFakeOidc();
    idps.push(idp);
    const memory = storage();
    const audit: SsoAuditEvent[] = [];
    const application = defineApplication({
        apps: [],
        database: { kind: 'prisma', provider: 'postgresql', connection: 'unused' },
        auth: defineAuth({
            baseURL: BASE_URL,
            secret: 'nestrum-admin-test-secret-longer-than-thirty-two-characters',
            prisma: () => memory.binding,
            ...(sso
                ? {
                      sso: {
                          enabled: true,
                          trustedIdpOrigins: [idp.origin],
                          onAudit: (event) => void audit.push(event),
                      },
                  }
                : {}),
        }),
        admin: defineAdmin(),
        policies: roleBasedAdminPolicies(),
    });
    const runtime = createHonoRuntime({ application, onError: () => {} });
    await runtime.start();
    const call = (path: string, init?: RequestInit) => runtime.fetch(new Request(`${BASE_URL}${path}`, init));
    const get = (path: string, cookie: string) => call(path, { headers: { cookie } });
    async function enroll(cookie: string) {
        const enabled = await call('/api/auth/two-factor/enable', json('POST', { password: PASSWORD }, cookie));
        const secret = totpSecretFromUri(((await enabled.json()) as { totpURI: string }).totpURI);
        const verified = await call(
            '/api/auth/two-factor/verify-totp',
            json('POST', { code: totpCode(secret, totpStep(Date.now())) }, cookie),
        );
        expect(verified.status).toBe(200);

        return cookieOf(verified);
    }
    async function member(email: string, role?: 'staff') {
        const response = await call(
            '/api/auth/sign-up/email',
            json('POST', { name: email, email, password: PASSWORD }),
        );
        const id = ((await response.json()) as { user: { id: string } }).user.id;
        if (role) {
            const user = memory.records.User.find((row) => row.id === id);
            if (user) {
                user.role = role;
            }
        }

        return { cookie: cookieOf(response), id };
    }
    async function administrator() {
        const created = await application.auth?.createAdministrator({
            email: 'root@example.test',
            name: 'Root',
            password: PASSWORD,
        });
        const login = await call(
            '/api/auth/sign-in/email',
            json('POST', { email: 'root@example.test', password: PASSWORD }),
        );

        return { cookie: await enroll(cookieOf(login)), id: created?.user.id as string };
    }

    return { call, get, enroll, member, administrator, application, memory, audit, idp };
}

const oidcBody = (idp: { issuer: string }, overrides: object = {}) => ({
    type: 'oidc',
    providerId: 'acme-okta',
    displayName: 'Acme Okta',
    organizationId: 'org-acme',
    domains: ['acme.test'],
    issuer: idp.issuer,
    clientId: 'client-1',
    clientSecret: 'super-secret-client-value',
    ...overrides,
});
const samlBody = (overrides: object = {}) => ({
    type: 'saml',
    providerId: 'initech-saml',
    displayName: 'Initech',
    domains: ['initech.test'],
    idpMetadata: idpMetadata(),
    ...overrides,
});

describe('Admin SSO management', () => {
    it('requires a session, admin access, 2FA and a specific SSO action', async () => {
        const { call, get, member, enroll, administrator, idp } = await setup();
        expect((await call('/__admin/auth/sso')).status).toBe(401);
        expect((await call('/__admin/auth/sso', json('POST', oidcBody(idp)))).status).toBe(401);
        const user = await member('user@example.test');
        const denied = await get('/__admin/auth/sso', user.cookie);
        expect(denied.status).toBe(403);
        expect(await denied.json()).toMatchObject({ error: { reason: 'NOT_STAFF' } });
        const staff = await member('staff@example.test', 'staff');
        const staffCookie = await enroll(staff.cookie);
        expect(await (await get('/__admin/auth/sso/capabilities', staffCookie)).json()).toEqual({
            enabled: true,
            read: false,
            create: false,
            update: false,
            delete: false,
            enable: false,
            disable: false,
            test: false,
        });
        for (const [path, method] of [
            ['/__admin/auth/sso', 'GET'],
            ['/__admin/auth/sso/x1', 'GET'],
            ['/__admin/auth/sso/x1/test', 'POST'],
            ['/__admin/auth/sso/x1/enable', 'POST'],
            ['/__admin/auth/sso/x1/disable', 'POST'],
            ['/__admin/auth/sso/x1', 'DELETE'],
        ] as const) {
            const response = await call(path, json(method, method === 'POST' ? {} : undefined, staffCookie));
            expect(response.status, `${method} ${path}`).toBe(403);
            expect(await response.json()).toMatchObject({ error: { reason: 'SSO_MANAGEMENT_DENIED' } });
        }
        const administratorSession = await administrator();
        expect(await (await get('/__admin/auth/sso/capabilities', administratorSession.cookie)).json()).toMatchObject({
            enabled: true,
            read: true,
            create: true,
            test: true,
        });
    });

    it('is refused across origins and absent when SSO is not enabled', async () => {
        const { call, administrator, idp } = await setup();
        const { cookie } = await administrator();
        const foreign = await call('/__admin/auth/sso', json('POST', oidcBody(idp), cookie, 'https://evil.example'));
        expect(foreign.status).toBe(403);
        const off = await setup(false);
        const admin = await off.administrator();
        expect((await off.get('/__admin/auth/sso', admin.cookie)).status).toBe(404);
        expect(await (await off.get('/__admin/auth/sso/capabilities', admin.cookie)).json()).toMatchObject({
            enabled: false,
            read: false,
        });
    });

    it('runs the OIDC provider lifecycle without ever returning the secret', async () => {
        const { call, get, administrator, idp, audit, memory } = await setup();
        const { cookie, id } = await administrator();
        const created = await call('/__admin/auth/sso', json('POST', oidcBody(idp), cookie));
        expect(created.status).toBe(201);
        expect(created.headers.get('cache-control')).toBe('no-store');
        const createdText = await created.text();
        expect(createdText).not.toContain('super-secret-client-value');
        expect(JSON.parse(createdText).provider).toMatchObject({
            providerId: 'acme-okta',
            clientSecretConfigured: true,
            createdBy: id,
        });
        expect(JSON.stringify(memory.records.SsoProvider)).not.toContain('super-secret-client-value');
        const listed = await get('/__admin/auth/sso', cookie);
        expect(await listed.text()).not.toContain('super-secret-client-value');
        const duplicate = await call('/__admin/auth/sso', json('POST', oidcBody(idp), cookie));
        expect(duplicate.status).toBe(409);
        expect(await duplicate.json()).toMatchObject({ error: { code: 'SSO_PROVIDER_EXISTS' } });
        const invalid = await call('/__admin/auth/sso', json('POST', oidcBody(idp, { providerId: 'Bad Id' }), cookie));
        expect(invalid.status).toBe(400);
        const edited = await call('/__admin/auth/sso/acme-okta', json('PATCH', { displayName: 'Acme SSO' }, cookie));
        expect(edited.status).toBe(200);
        expect(await edited.json()).toMatchObject({
            provider: { displayName: 'Acme SSO', providerId: 'acme-okta', clientSecretConfigured: true },
        });
        const tested = await call('/__admin/auth/sso/acme-okta/test', json('POST', {}, cookie));
        expect(await tested.json()).toMatchObject({ result: { valid: true, type: 'oidc' } });
        const disabled = await call('/__admin/auth/sso/acme-okta/disable', json('POST', {}, cookie));
        expect(await disabled.json()).toMatchObject({ provider: { enabled: false } });
        const enabled = await call('/__admin/auth/sso/acme-okta/enable', json('POST', {}, cookie));
        expect(await enabled.json()).toMatchObject({ provider: { enabled: true } });
        const removed = await call('/__admin/auth/sso/acme-okta', json('DELETE', undefined, cookie));
        expect(await removed.json()).toEqual({ deleted: true });
        expect((await get('/__admin/auth/sso/acme-okta', cookie)).status).toBe(404);
        expect(audit.map((event) => event.type)).toEqual([
            'created',
            'updated',
            'test-attempted',
            'disabled',
            'enabled',
            'deleted',
        ]);
        expect(audit.every((event) => event.actorId === id)).toBe(true);
        expect(JSON.stringify(audit)).not.toContain('super-secret');
    });

    it('runs the SAML lifecycle and shows service provider values', async () => {
        const { call, get, administrator } = await setup();
        const { cookie } = await administrator();
        const created = await call('/__admin/auth/sso', json('POST', samlBody(), cookie));
        expect(created.status).toBe(201);
        expect(await created.json()).toMatchObject({
            provider: {
                type: 'saml',
                serviceProvider: { acsUrl: `${BASE_URL}/api/auth/sso/saml2/sp/acs/initech-saml` },
            },
        });
        const bad = await call(
            '/__admin/auth/sso',
            json('POST', samlBody({ providerId: 'broken', idpMetadata: '<nope' }), cookie),
        );
        expect(bad.status).toBe(422);
        expect(await bad.text()).not.toContain('<nope');
        const tested = await call('/__admin/auth/sso/initech-saml/test', json('POST', {}, cookie));
        expect(await tested.json()).toMatchObject({ result: { valid: true, type: 'saml' } });
        expect((await get('/__admin/auth/sso/initech-saml', cookie)).status).toBe(200);
    });

    it('rejects unknown routes and malformed ids', async () => {
        const { call, administrator } = await setup();
        const { cookie } = await administrator();
        expect((await call('/__admin/auth/sso/a-b/unknown', json('POST', {}, cookie))).status).toBe(404);
        expect((await call('/__admin/auth/sso/Bad_Id', { headers: { cookie } })).status).toBe(400);
        expect((await call('/__admin/auth/sso', json('PUT', {}, cookie))).status).toBe(404);
    });
});

describe('SSO sessions and admin 2FA', () => {
    const now = new Date();
    const session = (overrides: object = {}): AuthSession => ({
        user: { id: 'u1', twoFactorEnabled: true, updatedAt: new Date(now.getTime() - 60_000) },
        session: { id: 's1', userId: 'u1', expiresAt: new Date(now.getTime() + 60_000), createdAt: now, ...overrides },
    });

    it('never treats an SSO session as having passed the second factor', () => {
        const policy = { required: true, assuranceTtlSeconds: 43_200 };
        expect(sessionAssurance(session(), policy)).toBe('satisfied');
        expect(sessionAssurance(session({ authMethod: 'sso', ssoProviderId: 'acme-okta' }), policy)).toBe(
            'challenge-required',
        );
        const enrolled = session({ authMethod: 'sso' });
        const unenrolled: AuthSession = { ...enrolled, user: { ...enrolled.user, twoFactorEnabled: false } };
        expect(sessionAssurance(unenrolled, policy)).toBe('setup-required');
    });

    it('blocks admin for an SSO-authenticated staff member who is enrolled, and for one who is not', async () => {
        const { application, call, get, memory, idp } = await setup();
        // biome-ignore lint/style/noNonNullAssertion: SSO is enabled in setup
        await application.auth!.sso!.create({
            type: 'oidc',
            providerId: 'acme-okta',
            displayName: 'Acme',
            domains: ['acme.test'],
            issuer: idp.issuer,
            clientId: 'client-1',
            clientSecret: 'secret-value',
        });
        const start = await call(
            '/api/auth/sign-in/sso',
            json('POST', { providerId: 'acme-okta', callbackURL: `${BASE_URL}/admin` }),
        );
        const url = new URL(((await start.json()) as { url: string }).url);
        const callback = await call(
            `/api/auth/sso/callback/acme-okta?code=abc&state=${url.searchParams.get('state')}`,
            { headers: { cookie: cookieOf(start) } },
        );
        expect(callback.status).toBe(302);
        const cookie = cookieOf(callback);
        // A new SSO user is an ordinary user: IdP attributes cannot make them staff.
        const asUser = await get('/__admin/auth/sso', cookie);
        expect(asUser.status).toBe(403);
        expect(await asUser.json()).toMatchObject({ error: { reason: 'NOT_STAFF' } });
        // An operator promotes them; without a second factor they still cannot reach admin.
        const user = memory.records.User.find((row) => row.email === 'sso.user@acme.test');
        expect(user).toBeDefined();
        Object.assign(user as object, { role: 'admin' });
        const setup1 = await get('/__admin/auth/sso', cookie);
        expect(setup1.status).toBe(403);
        expect(await setup1.json()).toMatchObject({ error: { code: 'ADMIN_2FA_REQUIRED' } });
        Object.assign(user as object, { twoFactorEnabled: true, updatedAt: new Date(Date.now() - 120_000) });
        const challenge = await get('/__admin/auth/sso', cookie);
        expect(challenge.status).toBe(403);
        expect(await challenge.json()).toMatchObject({ error: { code: 'ADMIN_2FA_REQUIRED' } });
    });
});
