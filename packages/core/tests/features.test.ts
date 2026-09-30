import { describe, expect, it } from 'vitest';
import type { FeatureStore } from '../src/index.js';
import {
    createFeatures,
    defineFeatureFlags,
    FeatureEvaluator,
    FeatureRegistry,
    MemoryFeatureStore,
    mergeFeatureDefinitions,
    murmur3,
    requestFeatureContext,
    rolloutBucket,
    withFeatureFlags,
} from '../src/index.js';

const definitions = {
    newDashboard: { default: false, exposeToClient: true },
    projectArchiving: { default: true },
    hidden: { default: false },
} as const;

function fixture(options: { environment?: string; cacheTtlMs?: number; overrides?: Record<string, boolean> } = {}) {
    const registry = new FeatureRegistry(definitions);
    const store = new MemoryFeatureStore();
    const events: unknown[] = [];
    const features = createFeatures({ registry, store, onChange: [(event) => void events.push(event)], ...options });

    return { registry, store, features, events };
}

describe('feature registry', () => {
    it('types names, freezes definitions and rejects invalid declarations', () => {
        const flags = defineFeatureFlags(definitions);
        expect(flags.registry.names()).toEqual(['newDashboard', 'projectArchiving', 'hidden']);
        expect(flags.registry.exposed()).toEqual(['newDashboard']);
        expect(Object.isFrozen(flags)).toBe(true);
        expect(Object.isFrozen(flags.registry.get('newDashboard'))).toBe(true);
        // @ts-expect-error unknown flags are not properties
        expect(flags.unknown).toBeUndefined();
        for (const bad of ['New', '1a', 'a-b', 'registry', 'has space', `a${'b'.repeat(64)}`]) {
            expect(() => defineFeatureFlags({ [bad]: { default: false } }), bad).toThrow(/camelCase|identifier/);
        }
        expect(() => defineFeatureFlags({ a: { default: 'yes' as never } })).toThrow(/boolean default/);
        expect(() => defineFeatureFlags({ a: { default: true, exposeToClient: 1 as never } })).toThrow();
        expect(() => defineFeatureFlags(null as never)).toThrow(/record/);
        expect(() => flags.registry.get('nope')).toThrowError(expect.objectContaining({ code: 'FEATURE_UNKNOWN' }));
    });

    it('rejects duplicate names across merged declarations', () => {
        expect(() => mergeFeatureDefinitions({ a: { default: true } }, { a: { default: false } })).toThrow(/twice/);
        expect(mergeFeatureDefinitions({ a: { default: true } }, { b: { default: false } })).toHaveProperty('b');
    });

    it('does not evaluate until the owning application binds the flags', async () => {
        const flags = defineFeatureFlags(definitions);
        await expect(flags.newDashboard.enabled()).rejects.toMatchObject({ code: 'FEATURES_NOT_READY' });
    });
});

describe('evaluation precedence', () => {
    it('falls back to declared defaults deterministically', async () => {
        const { features } = fixture();
        for (let index = 0; index < 3; index += 1) {
            expect(await features.evaluator.enabled('newDashboard')).toBe(false);
            expect(await features.evaluator.enabled('projectArchiving')).toBe(true);
        }
        expect(await features.evaluator.evaluate('newDashboard')).toEqual({
            flag: 'newDashboard',
            enabled: false,
            reason: { source: 'default' },
        });
        await expect(features.evaluator.enabled('missing')).rejects.toMatchObject({ code: 'FEATURE_UNKNOWN' });
    });

    it('applies subject, organization, percentage, environment, global, default in that order', async () => {
        const { features } = fixture({ environment: 'production' });
        const context = { subject: { id: 'u1' }, organizationId: 'org1' };
        const at = async () => (await features.evaluator.evaluate('newDashboard', context)).reason.source;
        const set = features.manager.set.bind(features.manager);

        expect(await at()).toBe('default');
        await set({ flag: 'newDashboard', scope: 'global', enabled: true });
        expect(await at()).toBe('global');
        await set({ flag: 'newDashboard', scope: 'environment', target: 'production', enabled: false });
        expect(await at()).toBe('environment');
        expect(await features.evaluator.enabled('newDashboard', context)).toBe(false);
        await set({ flag: 'newDashboard', scope: 'percentage', percentage: 100 });
        expect(await at()).toBe('percentage');
        expect(await features.evaluator.enabled('newDashboard', context)).toBe(true);
        await set({ flag: 'newDashboard', scope: 'organization', target: 'org1', enabled: false });
        expect(await at()).toBe('organization');
        expect(await features.evaluator.enabled('newDashboard', context)).toBe(false);
        await set({ flag: 'newDashboard', scope: 'subject', target: 'u1', enabled: true });
        expect(await at()).toBe('subject');
        expect(await features.evaluator.enabled('newDashboard', context)).toBe(true);
        // A different subject and organization only sees the layers below.
        expect(
            await features.evaluator.enabled('newDashboard', { subject: { id: 'u2' }, organizationId: 'org2' }),
        ).toBe(true);
    });

    it('skips inapplicable layers safely when context is missing', async () => {
        const { features } = fixture();
        await features.manager.set({ flag: 'hidden', scope: 'subject', target: 'u1', enabled: true });
        await features.manager.set({ flag: 'hidden', scope: 'organization', target: 'o1', enabled: true });
        await features.manager.set({ flag: 'hidden', scope: 'environment', target: 'production', enabled: true });
        await features.manager.set({ flag: 'hidden', scope: 'percentage', percentage: 100 });
        expect(await features.evaluator.enabled('hidden')).toBe(false);
        expect(await features.evaluator.enabled('hidden', { subject: { anonymous: true } })).toBe(false);
        expect(await features.evaluator.enabled('hidden', { environment: 'staging' })).toBe(false);
        expect(await features.evaluator.enabled('hidden', { environment: 'production' })).toBe(true);
    });

    it('lets in-process overrides win without touching storage', async () => {
        const { features, store } = fixture({ overrides: { hidden: true } });
        await features.manager.set({ flag: 'hidden', scope: 'global', enabled: false });
        expect(await features.evaluator.evaluate('hidden')).toEqual({
            flag: 'hidden',
            enabled: true,
            reason: { source: 'override' },
        });
        expect((await store.list('hidden')).map((rule) => rule.enabled)).toEqual([false]);
        const derived = features.evaluator.withOverrides({ newDashboard: true });
        expect(await derived.enabled('newDashboard')).toBe(true);
        expect(await features.evaluator.enabled('newDashboard')).toBe(false);
        expect(() => new FeatureEvaluator({ registry: features.registry, store, overrides: { nope: true } })).toThrow();
        expect(
            () => new FeatureEvaluator({ registry: features.registry, store, overrides: { hidden: 'x' as never } }),
        ).toThrow(/boolean/);
    });
});

describe('deterministic rollout', () => {
    it('hashes to stable, versioned buckets', () => {
        expect(murmur3('')).toBe(0);
        expect(murmur3('hello')).toBe(613153351);
        expect(murmur3('The quick brown fox jumps over the lazy dog')).toBe(776992547);
        expect(rolloutBucket('newDashboard', 'u1')).toBe(rolloutBucket('newDashboard', 'u1'));
        expect(rolloutBucket('newDashboard', 'u1')).not.toBe(rolloutBucket('projectArchiving', 'u1'));
        const buckets = Array.from({ length: 2000 }, (_, index) => rolloutBucket('newDashboard', `user-${index}`));
        expect(Math.min(...buckets)).toBeGreaterThanOrEqual(0);
        expect(Math.max(...buckets)).toBeLessThan(10_000);
        const below = buckets.filter((bucket) => bucket < 3000).length;
        expect(below).toBeGreaterThan(500);
        expect(below).toBeLessThan(700);
    });

    it('honours percentage boundaries and only moves when the percentage changes', async () => {
        const { features } = fixture();
        const users = Array.from({ length: 400 }, (_, index) => `user-${index}`);
        const enabledAt = async (percentage: number) => {
            await features.manager.set({ flag: 'newDashboard', scope: 'percentage', percentage });
            return (
                await Promise.all(users.map((id) => features.evaluator.enabled('newDashboard', { subject: { id } })))
            ).map(Number);
        };
        expect((await enabledAt(0)).every((value) => value === 0)).toBe(true);
        expect((await enabledAt(100)).every((value) => value === 1)).toBe(true);
        const ten = await enabledAt(10);
        const again = await enabledAt(10);
        const forty = await enabledAt(40);
        expect(again).toEqual(ten);
        // Raising the percentage never switches anybody off.
        expect(ten.every((value, index) => value <= (forty[index] as number))).toBe(true);
        const share = ten.filter(Boolean).length / users.length;
        expect(share).toBeGreaterThan(0.03);
        expect(share).toBeLessThan(0.2);
        const reason = await features.evaluator.evaluate('newDashboard', { subject: { id: users[ten.indexOf(1)] } });
        expect(reason.reason).toMatchObject({ source: 'percentage', percentage: 40 });
    });

    it('rolls out to anonymous actors only through an application-provided stable identifier', async () => {
        const { features } = fixture();
        await features.manager.set({ flag: 'newDashboard', scope: 'percentage', percentage: 100 });
        expect(await features.evaluator.enabled('newDashboard', { subject: { anonymous: true } })).toBe(false);
        expect(
            await features.evaluator.enabled('newDashboard', { subject: { anonymous: true }, stableId: 'device-1' }),
        ).toBe(true);
        const bound = features.forRequest({ subject: { anonymous: true }, environment: { featureKey: 'device-1' } });
        expect(await bound.enabled('newDashboard')).toBe(true);
        expect(
            await features
                .forRequest({ subject: { anonymous: true }, environment: { featureKey: 7 } })
                .enabled('newDashboard'),
        ).toBe(false);
    });
});

describe('rule validation, audit and invalidation', () => {
    it('rejects invalid rules', async () => {
        const { features } = fixture();
        const bad = (input: Parameters<typeof features.manager.set>[0]) =>
            expect(features.manager.set(input)).rejects.toMatchObject({ status: 400 });
        await bad({ flag: 'newDashboard', scope: 'percentage', percentage: 101 });
        await bad({ flag: 'newDashboard', scope: 'percentage', percentage: -1 });
        await bad({ flag: 'newDashboard', scope: 'percentage', percentage: 1.234 });
        await bad({ flag: 'newDashboard', scope: 'percentage' });
        await bad({ flag: 'newDashboard', scope: 'global', percentage: 5, enabled: true });
        await bad({ flag: 'newDashboard', scope: 'global', target: 'x', enabled: true });
        await bad({ flag: 'newDashboard', scope: 'subject', enabled: true });
        await bad({ flag: 'newDashboard', scope: 'subject', target: 'a b', enabled: true });
        await bad({ flag: 'newDashboard', scope: 'organization', target: 'o' });
        await bad({ flag: 'newDashboard', scope: 'nope' as never, enabled: true });
        await expect(features.manager.set({ flag: 'unknown', scope: 'global', enabled: true })).rejects.toMatchObject({
            code: 'FEATURE_UNKNOWN',
        });
        expect(await features.manager.list()).toEqual([]);
    });

    it('emits audit events for changes, survives listener failures, and updates one rule per key', async () => {
        const registry = new FeatureRegistry(definitions);
        const seen: unknown[] = [];
        const errors: unknown[] = [];
        const features = createFeatures({
            registry,
            onChange: [
                () => {
                    throw new Error('listener failed');
                },
                (event) => void seen.push(event),
            ],
            onError: (error) => void errors.push(error),
        });
        await features.manager.set({ flag: 'hidden', scope: 'global', enabled: true }, 'admin-1');
        await features.manager.set({ flag: 'hidden', scope: 'global', enabled: false }, 'admin-1');
        expect((await features.manager.list('hidden')).length).toBe(1);
        expect(await features.manager.remove('hidden', 'global', '', 'admin-2')).toBe(true);
        expect(await features.manager.remove('hidden', 'global')).toBe(false);
        expect(seen).toMatchObject([
            { type: 'set', flag: 'hidden', scope: 'global', enabled: true, actor: 'admin-1' },
            { type: 'set', enabled: false },
            { type: 'remove', actor: 'admin-2', enabled: null },
        ]);
        expect(errors).toHaveLength(3);
    });

    it('caches rules for a TTL and invalidates deterministically on manager writes', async () => {
        let now = 0;
        const registry = new FeatureRegistry(definitions);
        const inner = new MemoryFeatureStore();
        let reads = 0;
        const store: FeatureStore = {
            list: (flag) => (reads++, inner.list(flag)),
            upsert: (input) => inner.upsert(input),
            remove: (...args) => inner.remove(...args),
        };
        const evaluator = new FeatureEvaluator({ registry, store, cacheTtlMs: 1000, clock: () => now });
        expect(await evaluator.enabled('hidden')).toBe(false);
        expect(await evaluator.enabled('hidden')).toBe(false);
        expect(reads).toBe(1);
        // A write behind the evaluator's back stays invisible until the TTL passes or invalidate() is called.
        await inner.upsert({
            flag: 'hidden',
            scope: 'global',
            target: '',
            enabled: true,
            percentage: null,
            updatedBy: null,
        });
        expect(await evaluator.enabled('hidden')).toBe(false);
        evaluator.invalidate();
        expect(await evaluator.enabled('hidden')).toBe(true);
        now = 5000;
        await inner.remove('hidden', 'global', '');
        expect(await evaluator.enabled('hidden')).toBe(false);
        expect(reads).toBe(3);

        const features = createFeatures({ registry, store, cacheTtlMs: 60_000 });
        expect(await features.evaluator.enabled('hidden')).toBe(false);
        await features.manager.set({ flag: 'hidden', scope: 'global', enabled: true });
        expect(await features.evaluator.enabled('hidden')).toBe(true);
    });

    it('falls back to the declared default and reports when storage fails', async () => {
        const errors: unknown[] = [];
        const store: FeatureStore = {
            list: async () => {
                throw new Error('down');
            },
            upsert: async () => {
                throw new Error('down');
            },
            remove: async () => {
                throw new Error('down');
            },
        };
        const features = createFeatures({
            registry: new FeatureRegistry(definitions),
            store,
            onError: (error) => void errors.push(error),
        });
        expect(await features.evaluator.evaluate('projectArchiving')).toEqual({
            flag: 'projectArchiving',
            enabled: true,
            reason: { source: 'default', degraded: true },
        });
        expect(errors).toHaveLength(1);
    });
});

describe('request context and exposure', () => {
    it('derives context from trusted inputs only', () => {
        expect(requestFeatureContext({ id: 'u1', organizationId: 'o1' }, { featureKey: 'k' })).toEqual({
            subject: { id: 'u1', organizationId: 'o1' },
            organizationId: 'o1',
            stableId: 'k',
        });
        expect(requestFeatureContext({ id: 'u1' }, { organizationId: 'o2' }).organizationId).toBe('o2');
        expect(requestFeatureContext({ id: 'u1', organizationId: 5 }, {})).toEqual({
            subject: { id: 'u1', organizationId: 5 },
        });
    });

    it('returns evaluated booleans for exposeToClient flags only', async () => {
        const { features } = fixture();
        await features.manager.set({ flag: 'newDashboard', scope: 'subject', target: 'u1', enabled: true });
        await features.manager.set({ flag: 'hidden', scope: 'global', enabled: true });
        const bound = features.forRequest({ subject: { id: 'u1' }, environment: {} });
        expect(await bound.exposed()).toEqual({ newDashboard: true });
        expect(await features.forRequest({ subject: { id: 'u2' }, environment: {} }).exposed()).toEqual({
            newDashboard: false,
        });
        expect(await bound.enabled('newDashboard', { subject: { id: 'u9' } })).toBe(false);
    });
});

describe('withFeatureFlags', () => {
    it('isolates overrides for the callback and restores the previous binding', async () => {
        const flags = defineFeatureFlags(definitions);
        await withFeatureFlags(flags, { newDashboard: true }, async () => {
            expect(await flags.newDashboard.enabled()).toBe(true);
            expect(await flags.projectArchiving.enabled()).toBe(true);
            expect((await flags.newDashboard.evaluate()).reason.source).toBe('override');
        });
        await expect(flags.newDashboard.enabled()).rejects.toMatchObject({ code: 'FEATURES_NOT_READY' });
        await expect(
            withFeatureFlags(flags, { newDashboard: true }, () => {
                throw new Error('boom');
            }),
        ).rejects.toThrow('boom');
        await expect(flags.newDashboard.enabled()).rejects.toMatchObject({ code: 'FEATURES_NOT_READY' });
    });
});
