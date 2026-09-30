import type { FeaturesDefinition } from '@nestrum/core';
import { allow, bindFeatureFlags, createFeatures, defineApplication, defineFeatureFlags, deny } from '@nestrum/core';
import { describe, expect, it } from 'vitest';
import { createHonoRuntime } from '../src/index.js';

const flags = () =>
    defineFeatureFlags({
        newDashboard: { default: false, exposeToClient: true },
        experimentalSearch: { default: false },
        betaBanner: { default: true, exposeToClient: true },
    });

function definition(features: ReturnType<typeof flags>): FeaturesDefinition {
    return {
        kind: 'nestrum-features',
        database: undefined,
        protectedModels: [],
        createApp: () => ({ name: 'unused' }),
        async initialize() {
            const created = createFeatures({ registry: features.registry, environment: 'production' });
            bindFeatureFlags(features, created.evaluator);

            return created;
        },
    };
}

function build(withFeatures = true) {
    const features = flags();
    const application = defineApplication({
        apps: [],
        databases: { default: { kind: 'prisma', provider: 'postgresql', connection: 'unused' } },
        ...(withFeatures ? { features: definition(features) } : {}),
    });
    const runtime = createHonoRuntime({
        application,
        resolveSubject: (request) => {
            const id = request.headers.get('x-test-user');
            return id ? { id, organizationId: request.headers.get('x-test-org') ?? undefined } : { anonymous: true };
        },
        resolveEnvironment: (request) => {
            const key = request.headers.get('x-test-key');
            return key ? { featureKey: key } : {};
        },
    });

    return { features, application, runtime };
}

describe('feature flags in the request runtime', () => {
    it('injects request-bound evaluation through InferDI with the trusted subject and organization', async () => {
        const { application, runtime } = build();
        runtime.hono.get('/probe', async (context) => {
            const bound = context.var.di.get('features');
            expect(context.var.nestrum.features).toBeDefined();
            expect(context.var.di.get('features')).toBe(bound);

            return context.json({
                dashboard: await bound.enabled('newDashboard'),
                search: await bound.enabled('experimentalSearch'),
                reason: (await bound.evaluate('newDashboard')).reason,
            });
        });
        await runtime.start();
        const { manager } = application.features!;
        await manager.set({ flag: 'newDashboard', scope: 'subject', target: 'alice', enabled: true });
        await manager.set({ flag: 'experimentalSearch', scope: 'organization', target: 'acme', enabled: true });
        const get = async (headers: Record<string, string>) =>
            (await runtime.hono.request('/probe', { headers })).json();

        expect(await get({ 'x-test-user': 'alice', 'x-test-org': 'acme' })).toEqual({
            dashboard: true,
            search: true,
            reason: { source: 'subject', target: 'alice' },
        });
        expect(await get({ 'x-test-user': 'bob', 'x-test-org': 'acme' })).toMatchObject({
            dashboard: false,
            search: true,
        });
        expect(await get({ 'x-test-user': 'bob' })).toMatchObject({ dashboard: false, search: false });
        expect(await get({})).toMatchObject({ dashboard: false, search: false });
        // Client-supplied headers other than the test resolver's are never context.
        expect(await get({ 'x-organization-id': 'acme', 'x-user-id': 'alice' })).toMatchObject({
            dashboard: false,
            search: false,
        });
        await runtime.shutdown();
    });

    it('serves anonymous rollouts only through an application-provided stable identifier', async () => {
        const { application, runtime } = build();
        await runtime.start();
        await application.features!.manager.set({ flag: 'newDashboard', scope: 'percentage', percentage: 100 });
        const exposed = async (headers: Record<string, string> = {}) =>
            (await (await runtime.hono.request('/__nestrum/features', { headers })).json()) as {
                features: Record<string, boolean>;
            };
        expect((await exposed()).features.newDashboard).toBe(false);
        expect((await exposed({ 'x-test-key': 'device-1' })).features.newDashboard).toBe(true);
        expect((await exposed({ 'x-test-user': 'carol' })).features.newDashboard).toBe(true);
        await runtime.shutdown();
    });

    it('exposes only exposeToClient flags as evaluated booleans, uncached', async () => {
        const { application, runtime } = build();
        await runtime.start();
        await application.features!.manager.set({ flag: 'experimentalSearch', scope: 'global', enabled: true });
        await application.features!.manager.set({
            flag: 'newDashboard',
            scope: 'subject',
            target: 'alice',
            enabled: true,
        });
        await application.features!.manager.set({ flag: 'betaBanner', scope: 'percentage', percentage: 5 });
        const response = await runtime.hono.request('/__nestrum/features', { headers: { 'x-test-user': 'alice' } });
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(response.headers.get('vary')).toBe('Cookie');
        const text = await response.text();
        expect(JSON.parse(text)).toEqual({ features: { newDashboard: true, betaBanner: true } });
        for (const secret of ['experimentalSearch', 'percentage', 'reason', 'subject', 'rule', 'alice']) {
            expect(text, secret).not.toContain(secret);
        }
        expect((await runtime.hono.request('/__nestrum/features', { method: 'POST' })).status).toBe(404);
        await runtime.shutdown();
    });

    it('resolves a clear error when features are not configured, and registers no route', async () => {
        const { runtime } = build(false);
        runtime.hono.get('/probe', async (context) =>
            context.json({ on: await context.var.di.get('features').enabled('x') }),
        );
        await runtime.start();
        const response = await runtime.hono.request('/probe');
        expect(response.status).toBe(500);
        expect((await response.json()) as { error: { code: string } }).toMatchObject({
            error: { code: 'FEATURES_NOT_CONFIGURED' },
        });
        expect((await runtime.hono.request('/__nestrum/features')).status).toBe(404);
        await runtime.shutdown();
    });

    it('rejects a route that overlaps the framework feature route', async () => {
        const { runtime } = build();
        runtime.hono.get('/__nestrum/:anything', (context) => context.text('mine'));
        await expect(runtime.start()).rejects.toMatchObject({ code: 'FEATURES_ROUTE_CONFLICT' });
    });

    it('never lets a flag replace ABAC: enabled features still need authorization', async () => {
        const features = flags();
        const application = defineApplication({
            apps: [],
            databases: { default: { kind: 'prisma', provider: 'postgresql', connection: 'unused' } },
            features: definition(features),
            policies: [
                {
                    resource: 'reports',
                    actions: {
                        read: { authorize: ({ subject }) => (subject.role === 'admin' ? allow() : deny('NOT_ADMIN')) },
                    },
                },
            ],
        });
        const runtime = createHonoRuntime({
            application,
            resolveSubject: (request) => ({ id: 'u', role: request.headers.get('x-role') ?? 'user' }),
        });
        runtime.hono.get('/reports', async (context) => {
            const { features: bound, authorization, subject, environment } = context.var.nestrum;
            // The route requires both checks; flipping the flag never grants the action.
            const featureOn = await bound.enabled('newDashboard');
            const decision = await authorization.authorize({
                identity: 'reports',
                action: 'read',
                subject,
                environment,
            });

            return context.json({ featureOn, allowed: decision.allowed, available: featureOn && decision.allowed });
        });
        await runtime.start();
        await application.features!.manager.set({ flag: 'newDashboard', scope: 'global', enabled: true });
        const read = async (role: string) =>
            (await runtime.hono.request('/reports', { headers: { 'x-role': role } })).json();
        expect(await read('user')).toEqual({ featureOn: true, allowed: false, available: false });
        expect(await read('admin')).toEqual({ featureOn: true, allowed: true, available: true });
        await application.features!.manager.set({ flag: 'newDashboard', scope: 'global', enabled: false });
        expect(await read('admin')).toEqual({ featureOn: false, allowed: true, available: false });
        await runtime.shutdown();
    });
});
