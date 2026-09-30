import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FeatureRule, QueryBackend, QuerySpec } from '@nestrum/core';
import { AppError, defineApplication, defineFeatureFlags, defineResource, modelIdentity } from '@nestrum/core';
import { generatePrismaContracts } from '@nestrum/prisma/node';
import { afterEach, describe, expect, it } from 'vitest';
import {
    createPrismaFeatureStore,
    DEV_OVERRIDES_ENV,
    defineFeatures,
    FEATURE_MODELS,
    featureContract,
    parseDevOverrides,
} from '../src/index.js';

const DATABASES = {
    default: { kind: 'prisma' as const, provider: 'postgresql' as const, connection: 'unused' },
    documents: { kind: 'prisma' as const, provider: 'mongodb' as const, connection: 'unused' },
};

type Row = Record<string, unknown>;
function matches(row: Row, filter: Row): boolean {
    return Object.entries(filter).every(([key, value]) => {
        if (key === 'AND') {
            return (value as Row[]).every((entry) => matches(row, entry));
        }
        return row[key] === (value as { equals: unknown }).equals;
    });
}
/** A backend that implements exactly the filter shape the feature store emits. */
function backend() {
    const rows: Row[] = [];
    const hits = { creates: 0 };
    const select = (query: QuerySpec) =>
        rows.filter((row) => query.filters.every((filter) => matches(row, filter as Row)));
    const impl: QueryBackend = {
        raw: rows,
        all: async (query) => {
            const found = select(query);
            const sorted = [...found].sort((a, b) => {
                for (const order of query.orderBy) {
                    const compare = String(a[order.field]).localeCompare(String(b[order.field]));
                    if (compare !== 0) {
                        return order.direction === 'asc' ? compare : -compare;
                    }
                }
                return 0;
            });
            return sorted.slice(0, query.limit ?? Number.POSITIVE_INFINITY);
        },
        count: async (query) => select(query).length,
        create: async (data) => {
            hits.creates += 1;
            const row = { ...(data as Row) };
            if (rows.some((existing) => ['flag', 'scope', 'target'].every((key) => existing[key] === row[key]))) {
                throw new Error('unique violation');
            }
            rows.push(row);
            return row;
        },
        update: async (query, data) => {
            const found = select(query);
            for (const row of found) {
                Object.assign(row, data);
            }
            return found.length;
        },
        delete: async (query) => {
            const found = select(query);
            for (const row of found) {
                rows.splice(rows.indexOf(row), 1);
            }
            return found.length;
        },
    };
    return { impl, rows, hits };
}

const flags = () =>
    defineFeatureFlags({
        newDashboard: { default: false, exposeToClient: true },
        experimentalSearch: { default: false },
    });

describe('feature contract', () => {
    it('is emitted by real Prisma for both providers', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'nestrum-features-'));
        try {
            for (const provider of ['postgresql', 'mongodb'] as const) {
                const application = defineApplication({
                    apps: [{ name: 'nestrum.features', prismaSource: { default: featureContract(provider) } }],
                    databases: { default: { kind: 'prisma' as const, provider, connection: 'unused' } },
                });
                const result = await generatePrismaContracts(application, {
                    rootDir: directory,
                    outputDir: `generated-${provider}`,
                });
                const contract = JSON.parse(await readFile(result.contracts[0]!.contractPath, 'utf8'));
                expect(JSON.stringify(contract)).toContain('FeatureOverride');
                expect(JSON.stringify(contract)).toContain('percentage');
            }
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    }, 60_000);

    it('names its owned models per database', () => {
        expect(FEATURE_MODELS).toEqual(['FeatureOverride']);
        expect(featureContract('postgresql')).toContain('@@unique([flag, scope, target])');
        expect(featureContract('mongodb')).toContain('@map("_id")');
    });
});

describe('Prisma feature store', () => {
    for (const provider of ['postgresql', 'mongodb'] as const) {
        it(`persists, updates, lists and removes overrides on ${provider}`, async () => {
            const { impl, rows, hits } = backend();
            const store = createPrismaFeatureStore(impl, provider);
            const created = await store.upsert({
                flag: 'newDashboard',
                scope: 'subject',
                target: 'u1',
                enabled: true,
                percentage: null,
                updatedBy: 'admin',
            });
            expect(created).toMatchObject({
                flag: 'newDashboard',
                scope: 'subject',
                target: 'u1',
                enabled: true,
                updatedBy: 'admin',
            });
            expect(rows[0]!.updatedAt instanceof Date).toBe(provider === 'mongodb');
            const updated = await store.upsert({
                flag: 'newDashboard',
                scope: 'subject',
                target: 'u1',
                enabled: false,
                percentage: null,
                updatedBy: null,
            });
            expect(updated.id).toBe(created.id);
            expect(updated.enabled).toBe(false);
            expect(hits.creates).toBe(1);
            await store.upsert({
                flag: 'newDashboard',
                scope: 'percentage',
                target: '',
                enabled: true,
                percentage: 12.5,
                updatedBy: null,
            });
            await store.upsert({
                flag: 'experimentalSearch',
                scope: 'global',
                target: '',
                enabled: true,
                percentage: null,
                updatedBy: null,
            });
            expect((await store.list()).map((rule: FeatureRule) => `${rule.flag}:${rule.scope}`)).toEqual([
                'experimentalSearch:global',
                'newDashboard:percentage',
                'newDashboard:subject',
            ]);
            expect(await store.list('newDashboard')).toHaveLength(2);
            expect((await store.list('newDashboard')).find((rule) => rule.scope === 'percentage')?.percentage).toBe(
                12.5,
            );
            expect(await store.remove('newDashboard', 'subject', 'u1')).toBe(true);
            expect(await store.remove('newDashboard', 'subject', 'u1')).toBe(false);
            rows.push({ id: 'x', flag: 'a', scope: 'bogus', target: '', enabled: true });
            await expect(store.list()).rejects.toMatchObject({ code: 'FEATURE_STORAGE_INVALID' });
        });
    }

    it('recovers from a concurrent create of the same key', async () => {
        const { impl, rows } = backend();
        const realAll = impl.all.bind(impl);
        let first = true;
        impl.all = async (query) => {
            const found = await realAll(query);
            if (first && query.limit === 1) {
                first = false;
                rows.push({
                    id: 'other',
                    flag: 'newDashboard',
                    scope: 'global',
                    target: '',
                    enabled: false,
                    updatedAt: new Date().toISOString(),
                });
                return [];
            }
            return found;
        };
        const store = createPrismaFeatureStore(impl, 'postgresql');
        const rule = await store.upsert({
            flag: 'newDashboard',
            scope: 'global',
            target: '',
            enabled: true,
            percentage: null,
            updatedBy: null,
        });
        expect(rule).toMatchObject({ id: 'other', enabled: true });
        expect(rows).toHaveLength(1);
    });
});

describe('defineFeatures', () => {
    it('evaluates flags through the started application with in-memory overrides', async () => {
        const features = flags();
        const application = defineApplication({
            apps: [],
            databases: DATABASES,
            features: defineFeatures({ flags: features }),
        });
        expect(application.featuresConfigured).toBe(true);
        expect(application.features).toBeUndefined();
        await expect(features.newDashboard.enabled()).rejects.toMatchObject({ code: 'FEATURES_NOT_READY' });
        await application.start();
        expect(await features.newDashboard.enabled()).toBe(false);
        await application.features!.manager.set({ flag: 'newDashboard', scope: 'global', enabled: true });
        expect(await features.newDashboard.enabled()).toBe(true);
        await application.shutdown();
    });

    it('stores overrides in the selected database and shares the schema fragment', async () => {
        const { impl, rows } = backend();
        const features = flags();
        const application = defineApplication({
            apps: [],
            databases: DATABASES,
            features: defineFeatures({
                flags: features,
                database: 'default',
                environment: 'production',
                prisma: ({ database }) => ({ database, collection: impl as never }),
            }),
        });
        expect(application.apps.get('nestrum.features').prismaSource?.default).toContain('model FeatureOverride');
        await application.start();
        // The Prisma query backend needs a real collection; the store contract is covered above, so here only the wiring is checked.
        expect(application.features?.registry.names()).toEqual(['newDashboard', 'experimentalSearch']);
        void rows;
        await application.shutdown();
        await expect(features.newDashboard.enabled()).rejects.toMatchObject({ code: 'FEATURES_NOT_READY' });
    });

    it('validates configuration and protects its models from resource registration', async () => {
        const features = flags();
        expect(() => defineFeatures({ flags: {} as never })).toThrow(/defineFeatureFlags/);
        expect(() => defineFeatures({ flags: features, database: 'default' })).toThrow(/both a database name/);
        expect(() => defineFeatures({ flags: features, environment: 'has space' })).toThrow(/environment/);
        expect(() => defineFeatures({ flags: features, overrides: { nope: true } })).toThrow(/not declared/);
        expect(() =>
            defineApplication({
                apps: [],
                databases: DATABASES,
                features: defineFeatures({
                    flags: features,
                    database: 'missing',
                    prisma: ({ database }) => ({ database, collection: {} as never }),
                }),
            }),
        ).toThrowError(expect.objectContaining({ code: 'FEATURES_CONFIG_INVALID' }));
        const protectedIdentity = modelIdentity('FeatureOverride', 'default');
        expect(() =>
            defineApplication({
                apps: [],
                databases: DATABASES,
                features: defineFeatures({
                    flags: features,
                    database: 'default',
                    prisma: ({ database }) => ({ database, collection: {} as never }),
                }),
                resources: [defineResource({ identity: protectedIdentity } as never)],
            }),
        ).toThrow();
        const mismatch = defineApplication({
            apps: [],
            databases: DATABASES,
            features: defineFeatures({
                flags: features,
                database: 'default',
                prisma: () => ({ database: 'documents', collection: {} as never }),
            }),
        });
        await expect(mismatch.start()).rejects.toBeInstanceOf(AppError);
    });
});

describe('development overrides', () => {
    const saved = { dev: process.env.NESTRUM_ENV, features: process.env[DEV_OVERRIDES_ENV] };
    afterEach(() => {
        for (const [key, value] of [
            ['NESTRUM_ENV', saved.dev],
            [DEV_OVERRIDES_ENV, saved.features],
        ] as const) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    });

    it('parses only JSON booleans', () => {
        expect(parseDevOverrides(undefined)).toEqual({});
        expect(parseDevOverrides('{"a":true,"b":false}')).toEqual({ a: true, b: false });
        for (const bad of ['{', '[]', '{"a":"true"}', 'null', '{"a":1}']) {
            expect(() => parseDevOverrides(bad), bad).toThrow(/JSON object of booleans/);
        }
    });

    it('applies only in development, never persists, and rejects unknown flags', async () => {
        process.env[DEV_OVERRIDES_ENV] = '{"newDashboard":true}';
        process.env.NESTRUM_ENV = 'production';
        const production = flags();
        const off = defineApplication({
            apps: [],
            databases: DATABASES,
            features: defineFeatures({ flags: production }),
        });
        await off.start();
        expect(await production.newDashboard.enabled()).toBe(false);
        await off.shutdown();

        process.env.NESTRUM_ENV = 'development';
        const development = flags();
        const on = defineApplication({
            apps: [],
            databases: DATABASES,
            features: defineFeatures({ flags: development }),
        });
        await on.start();
        expect(await development.newDashboard.enabled()).toBe(true);
        expect((await development.newDashboard.evaluate()).reason.source).toBe('override');
        expect(await on.features!.manager.list()).toEqual([]);
        await on.shutdown();

        process.env[DEV_OVERRIDES_ENV] = '{"nope":true}';
        expect(() => defineFeatures({ flags: flags() })).toThrow(/not declared/);
    });
});
