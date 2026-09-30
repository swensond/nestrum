import { defineAuth, totpCode, totpSecretFromUri, totpStep } from '@nestrum/auth';
import type { FeatureChangeEvent, FeaturesDefinition } from '@nestrum/core';
import { bindFeatureFlags, createFeatures, defineApplication, defineFeatureFlags } from '@nestrum/core';
import { createHonoRuntime } from '@nestrum/hono';
import { describe, expect, it } from 'vitest';
import { storage } from '../../auth/tests/fixtures.js';
import { defineAdmin, roleBasedAdminPolicies } from '../src/index.js';

const BASE_URL = 'http://localhost:3000';
const PASSWORD = 'a-valid-password-123';

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

async function setup(configured = true) {
    const memory = storage();
    const events: FeatureChangeEvent[] = [];
    const flags = defineFeatureFlags({
        newDashboard: { default: false, exposeToClient: true, description: 'Redesigned dashboard' },
        experimentalSearch: { default: true },
    });
    const features: FeaturesDefinition = {
        kind: 'nestrum-features',
        database: undefined,
        protectedModels: [],
        createApp: () => ({ name: 'unused' }),
        async initialize() {
            const created = createFeatures({
                registry: flags.registry,
                environment: 'production',
                onChange: [(event) => void events.push(event)],
            });
            bindFeatureFlags(flags, created.evaluator);

            return created;
        },
    };
    const application = defineApplication({
        apps: [],
        databases: {
            default: { kind: 'prisma', provider: 'postgresql', connection: 'unused' },
            identity: { kind: 'prisma', provider: 'postgresql', connection: 'unused' },
        },
        auth: defineAuth({
            database: 'identity',
            baseURL: BASE_URL,
            secret: 'nestrum-admin-test-secret-longer-than-thirty-two-characters',
            prisma: () => memory.binding,
        }),
        admin: defineAdmin(),
        ...(configured ? { features } : {}),
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
    async function administrator(enrolled = true) {
        const created = await application.auth?.createAdministrator({
            email: 'root@example.test',
            name: 'Root',
            password: PASSWORD,
        });
        const login = await call(
            '/api/auth/sign-in/email',
            json('POST', { email: 'root@example.test', password: PASSWORD }),
        );

        return {
            cookie: enrolled ? await enroll(cookieOf(login)) : cookieOf(login),
            id: created!.user.id,
            login: cookieOf(login),
        };
    }

    return { call, get, enroll, member, administrator, application, events };
}

describe('Admin feature management', () => {
    it('is denied to anonymous requests, users and unenrolled administrators; staff may only read', async () => {
        const { call, get, member, enroll, administrator } = await setup();
        expect((await call('/__admin/features')).status).toBe(401);
        expect(
            (await call('/__admin/features/newDashboard/rules', json('PUT', { scope: 'global', enabled: true })))
                .status,
        ).toBe(401);
        const user = await member('user@example.test');
        const denied = await get('/__admin/features', user.cookie);
        expect(denied.status).toBe(403);
        expect(await denied.json()).toMatchObject({ error: { reason: 'NOT_STAFF' } });
        const unenrolled = await administrator(false);
        // Signed in but not yet through the second factor.
        const stopped = await get('/__admin/features', unenrolled.login);
        expect(stopped.status).toBe(403);
        expect(await stopped.json()).toMatchObject({ error: { code: 'ADMIN_2FA_REQUIRED' } });
        expect(
            (
                await call(
                    '/__admin/features/newDashboard/rules',
                    json('PUT', { scope: 'global', enabled: true }, unenrolled.login),
                )
            ).status,
        ).toBe(403);

        const staff = await member('staff@example.test', 'staff');
        const staffCookie = await enroll(staff.cookie);
        expect(await (await get('/__admin/features/capabilities', staffCookie)).json()).toEqual({
            read: true,
            manage: false,
        });
        expect((await get('/__admin/features', staffCookie)).status).toBe(200);
        const write = await call(
            '/__admin/features/newDashboard/rules',
            json('PUT', { scope: 'global', enabled: true }, staffCookie),
        );
        expect(write.status).toBe(403);
        expect(await write.json()).toMatchObject({ error: { reason: 'FEATURE_MANAGEMENT_DENIED' } });
        expect(
            (await call('/__admin/features/newDashboard/rules?scope=global', json('DELETE', undefined, staffCookie)))
                .status,
        ).toBe(403);
        const enrolledAdmin = await enroll(unenrolled.login);
        expect(await (await get('/__admin/features/capabilities', enrolledAdmin)).json()).toEqual({
            read: true,
            manage: true,
        });
    });

    it('lists declared flags with defaults, exposure and overrides', async () => {
        const { call, get, administrator } = await setup();
        const { cookie } = await administrator();
        const before = (await (await get('/__admin/features', cookie)).json()) as {
            flags: {
                name: string;
                default: boolean;
                exposeToClient: boolean;
                description?: string;
                rules: unknown[];
            }[];
        };
        expect(before.flags).toEqual([
            {
                name: 'newDashboard',
                default: false,
                exposeToClient: true,
                description: 'Redesigned dashboard',
                rules: [],
            },
            { name: 'experimentalSearch', default: true, exposeToClient: false, rules: [] },
        ]);
        const put = await call(
            '/__admin/features/newDashboard/rules',
            json('PUT', { scope: 'percentage', percentage: 25 }, cookie),
        );
        expect(put.status).toBe(200);
        expect(put.headers.get('cache-control')).toBe('no-store');
        const after = (await (await get('/__admin/features', cookie)).json()) as typeof before;
        expect(after.flags[0]!.rules).toMatchObject([
            { scope: 'percentage', percentage: 25, target: '', enabled: true },
        ]);
    });

    it('sets and removes global, environment, subject, organization and rollout overrides, with audit events', async () => {
        const { call, get, administrator, application, events } = await setup();
        const admin = await administrator();
        const put = (flag: string, body: unknown) =>
            call(`/__admin/features/${flag}/rules`, json('PUT', body, admin.cookie));
        expect((await put('newDashboard', { scope: 'global', enabled: true })).status).toBe(200);
        expect(await application.features!.evaluator.enabled('newDashboard')).toBe(true);
        expect((await put('newDashboard', { scope: 'environment', target: 'production', enabled: false })).status).toBe(
            200,
        );
        expect(await application.features!.evaluator.enabled('newDashboard')).toBe(false);
        expect((await put('newDashboard', { scope: 'organization', target: 'acme', enabled: true })).status).toBe(200);
        expect((await put('newDashboard', { scope: 'subject', target: 'user-9', enabled: true })).status).toBe(200);
        expect(await application.features!.evaluator.enabled('newDashboard', { organizationId: 'acme' })).toBe(true);
        expect(await application.features!.evaluator.enabled('newDashboard', { stableId: 'user-9' })).toBe(true);
        expect(await application.features!.evaluator.enabled('newDashboard', { stableId: 'user-8' })).toBe(false);

        const explained = await call(
            '/__admin/features/newDashboard/explain',
            json('POST', { subjectId: 'user-9', organizationId: 'other' }, admin.cookie),
        );
        expect(await explained.json()).toEqual({
            evaluation: { flag: 'newDashboard', enabled: true, reason: { source: 'subject', target: 'user-9' } },
        });
        const orgExplained = (await (
            await call('/__admin/features/newDashboard/explain', json('POST', { organizationId: 'acme' }, admin.cookie))
        ).json()) as { evaluation: { reason: unknown } };
        expect(orgExplained.evaluation.reason).toEqual({ source: 'organization', target: 'acme' });
        const envExplained = (await (
            await call('/__admin/features/newDashboard/explain', json('POST', {}, admin.cookie))
        ).json()) as { evaluation: { reason: unknown } };
        expect(envExplained.evaluation.reason).toEqual({ source: 'environment', target: 'production' });

        const removed = await call(
            '/__admin/features/newDashboard/rules?scope=subject&target=user-9',
            json('DELETE', undefined, admin.cookie),
        );
        expect(removed.status).toBe(204);
        expect(await application.features!.evaluator.enabled('newDashboard', { stableId: 'user-9' })).toBe(false);
        const missing = await call(
            '/__admin/features/newDashboard/rules?scope=subject&target=user-9',
            json('DELETE', undefined, admin.cookie),
        );
        expect(missing.status).toBe(404);
        expect(await missing.json()).toMatchObject({ error: { code: 'FEATURE_RULE_NOT_FOUND' } });

        expect(events.map((event) => `${event.type}:${event.scope}`)).toEqual([
            'set:global',
            'set:environment',
            'set:organization',
            'set:subject',
            'remove:subject',
        ]);
        expect(events.every((event) => event.actor === admin.id)).toBe(true);
        expect(await (await get('/__admin/features', admin.cookie)).text()).not.toContain('password');
    });

    it('rejects invalid input, unknown flags and unsupported routes', async () => {
        const { call, administrator } = await setup();
        const { cookie } = await administrator();
        const put = (path: string, body: unknown) => call(path, json('PUT', body, cookie));
        for (const body of [
            { scope: 'global' },
            { scope: 'global', enabled: 'yes' },
            { scope: 'percentage', percentage: 101 },
            { scope: 'percentage', percentage: 1.234 },
            { scope: 'subject', enabled: true },
            { scope: 'global', enabled: true, extra: 1 },
            { scope: 'unknown', enabled: true },
            {},
        ]) {
            expect((await put('/__admin/features/newDashboard/rules', body)).status, JSON.stringify(body)).toBe(400);
        }
        expect((await put('/__admin/features/nope/rules', { scope: 'global', enabled: true })).status).toBe(404);
        expect(
            (await call('/__admin/features/newDashboard/explain', json('POST', { attributes: { a: 1 } }, cookie)))
                .status,
        ).toBe(400);
        expect((await call('/__admin/features/newDashboard/explain', json('POST', {}, cookie))).status).toBe(200);
        expect((await call('/__admin/features/nope/explain', json('POST', {}, cookie))).status).toBe(404);
        expect((await call('/__admin/features/newDashboard', json('GET', undefined, cookie))).status).toBe(404);
        expect((await call('/__admin/features', json('POST', {}, cookie))).status).toBeGreaterThanOrEqual(400);
    });

    it('enforces the same-origin policy on writes', async () => {
        const { call, administrator, application } = await setup();
        const { cookie } = await administrator();
        const cross = await call(
            '/__admin/features/newDashboard/rules',
            json('PUT', { scope: 'global', enabled: true }, cookie, 'https://evil.example'),
        );
        expect(cross.status).toBe(403);
        expect(await application.features!.manager.list()).toEqual([]);
    });

    it('has no feature routes when features are not configured', async () => {
        const { call, administrator } = await setup(false);
        const { cookie } = await administrator();
        expect((await call('/__admin/features', { headers: { cookie } })).status).toBe(404);
        expect((await call('/__admin/features/capabilities', { headers: { cookie } })).status).toBe(404);
    });
});
