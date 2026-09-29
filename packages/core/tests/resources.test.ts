import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ResourceConfig, ResourceModel } from '../src/index.js';
import {
    DatabaseRegistry,
    defineApp,
    defineApplication,
    defineResource,
    ResourceError,
    ResourceRegistry,
} from '../src/index.js';

const DATABASES = {
    default: { kind: 'prisma', provider: 'postgresql', connection: 'unused' },
    documents: { kind: 'prisma', provider: 'mongodb', connection: 'unused' },
} as const;

function model(name = 'Project', database = 'default'): ResourceModel {
    const scalarFields = Object.freeze([
        Object.freeze({
            name: 'id',
            codec: 'pg/int4@1',
            kind: 'integer' as const,
            nullable: false,
            optional: false,
            array: false,
            primaryKey: true,
            hasCreateDefault: true,
            hasUpdateDefault: false,
        }),
        Object.freeze({
            name: 'name',
            codec: 'pg/text@1',
            kind: 'string' as const,
            nullable: false,
            optional: false,
            array: false,
            primaryKey: false,
            hasCreateDefault: false,
            hasUpdateDefault: false,
        }),
    ]);
    const record = z.strictObject({ id: z.number().int(), name: z.string() });

    return Object.freeze({
        metadata: Object.freeze({
            database,
            name,
            identity: `${database}.${name}` as `${string}.${string}`,
            provider: database === 'documents' ? 'mongodb' : 'postgresql',
            namespace: 'public',
            fields: scalarFields,
            relations: Object.freeze([]),
        }),
        model: record,
        read: record,
        create: z.strictObject({ id: z.number().int().optional(), name: z.string() }),
        update: z.strictObject({ name: z.string().optional() }),
        where: z.strictObject({ name: z.string().optional() }),
        orderBy: z.strictObject({ name: z.enum(['asc', 'desc']).optional() }),
    });
}

function registry(definitions = [defineResource({ model: 'Project' })]) {
    return new ResourceRegistry(definitions, new DatabaseRegistry(DATABASES));
}

describe('Resource definitions', () => {
    it('defaults database and disables every public operation', () => {
        const definition = defineResource({ model: 'Project' });
        expect(definition.database).toBe('default');
        expect(definition.identity).toBe('default.Project');
        expect(definition.api).toEqual({ list: false, retrieve: false, create: false, update: false, delete: false });
        expect(defineResource({ model: 'User', api: false }).api).toEqual(definition.api);
    });

    it('enables only explicitly requested API operations and snapshots configuration', () => {
        const api = { list: true, create: false };
        const schemas: { create: (schema: z.ZodObject) => z.ZodObject } = {
            create: (schema: z.ZodObject) => schema.extend({ name: z.string().min(3) }),
        };
        const config = { model: 'Article', database: 'documents', api, schemas };
        const definition = defineResource(config);
        api.list = false;
        schemas.create = (schema) => schema;
        config.model = 'Renamed';
        expect(definition.identity).toBe('documents.Article');
        expect(definition.api).toEqual({ list: true, retrieve: false, create: false, update: false, delete: false });
        for (const value of [definition, definition.api, definition.schemas]) {
            expect(Object.isFrozen(value)).toBe(true);
        }
        expect(Object.isFrozen(api)).toBe(false);
        expect(definition.schemas.create!(model().create).safeParse({ name: 'ab' }).success).toBe(false);
    });

    it.each([
        null,
        [],
        { model: '' },
        { model: 'default.Project' },
        { model: 'Project', database: '' },
        { model: 'Project', database: null },
        { model: 'Project', api: true },
        { model: 'Project', api: { list: 'true' } },
        { model: 'Project', api: { archive: true } },
        { model: 'Project', schemas: null },
        { model: 'Project', schemas: { create: z.object({}) } },
        { model: 'Project', schemas: { typo: () => z.object({}) } },
    ])('rejects malformed definitions (%j)', (config) => {
        expect(() => defineResource(config as unknown as ResourceConfig)).toThrow(
            expect.objectContaining({ code: 'RESOURCE_CONFIG_INVALID' }),
        );
    });
});

describe('ResourceRegistry', () => {
    it('requires initialized models and returns immutable registered resources in declaration order', () => {
        const resources = registry([
            defineResource({ model: 'Project' }),
            defineResource({ model: 'Article', database: 'documents' }),
        ]);
        expect(() => resources.all()).toThrow(expect.objectContaining({ code: 'RESOURCE_REGISTRY_NOT_READY' }));
        resources.initialize([model('Article', 'documents'), model()]);
        expect(resources.all().map((resource) => resource.identity)).toEqual(['default.Project', 'documents.Article']);
        expect(resources.has('default.Project')).toBe(true);
        expect(resources.has('Project')).toBe(false);
        expect(resources.get('documents.Article').metadata.name).toBe('Article');
        for (const value of [
            resources.all(),
            resources.get('default.Project'),
            resources.get('default.Project').schemas,
        ]) {
            expect(Object.isFrozen(value)).toBe(true);
        }
        expect(() => resources.get('missing.Project')).toThrow(expect.objectContaining({ code: 'RESOURCE_NOT_FOUND' }));
        expect(() => resources.initialize([])).toThrow(
            expect.objectContaining({ code: 'RESOURCE_REGISTRY_INITIALIZED' }),
        );
    });

    it('rejects duplicate canonical identities but allows the same model name in different databases', () => {
        expect(() =>
            registry([defineResource({ model: 'Project' }), defineResource({ model: 'Project', database: 'default' })]),
        ).toThrow(expect.objectContaining({ code: 'RESOURCE_DUPLICATE' }));
        const resources = registry([
            defineResource({ model: 'Project' }),
            defineResource({ model: 'Project', database: 'documents' }),
        ]);
        resources.initialize([model(), model('Project', 'documents')]);
        expect(resources.all()).toHaveLength(2);
    });

    it('rejects unknown databases immediately and missing models during initialization', () => {
        expect(() => registry([defineResource({ database: 'identity', model: 'User' })])).toThrow(
            expect.objectContaining({ code: 'RESOURCE_DATABASE_UNKNOWN' }),
        );
        const resources = registry();
        expect(() => resources.initialize([model('Other')])).toThrow(
            expect.objectContaining({ code: 'RESOURCE_MODEL_MISSING' }),
        );
        expect(() => resources.get('default.Project')).toThrow(
            expect.objectContaining({ code: 'RESOURCE_REGISTRY_NOT_READY' }),
        );
    });

    it('composes every family against the generated baseline without changing it', () => {
        const baseline = model();
        const resources = registry([
            defineResource({
                model: 'Project',
                schemas: {
                    model: (schema) => schema.extend({ name: z.string().min(3) }),
                    create: (schema) => schema.extend({ name: z.string().min(3) }),
                    update: (schema) => schema.extend({ name: z.string().min(3).optional() }),
                    read: (schema) => schema.extend({ name: z.string().min(3) }),
                    where: (schema) => schema.refine((value) => (value as { name?: string }).name !== 'forbidden'),
                    orderBy: (schema) => schema.refine((value) => value.name !== 'desc'),
                },
            }),
        ]);
        resources.initialize([baseline]);
        const schemas = resources.get('default.Project').schemas;
        expect(schemas.create.safeParse({ name: 'abcd' }).success).toBe(true);
        for (const key of ['model', 'create', 'update', 'read'] as const) {
            expect(
                schemas[key].safeParse({ ...(key === 'model' || key === 'read' ? { id: 1 } : {}), name: 'ab' }).success,
            ).toBe(false);
        }
        expect(schemas.where.safeParse({ name: 'forbidden' }).success).toBe(false);
        expect(schemas.orderBy.safeParse({ name: 'desc' }).success).toBe(false);
        expect(baseline.create.safeParse({ name: 'ab' }).success).toBe(true);
    });

    it('inherits untouched schemas by reference and never mutates a shared family', () => {
        const baseline = model();
        const resources = registry();
        resources.initialize([baseline]);
        expect(resources.get('default.Project').schemas.create).toBe(baseline.create);
        expect(resources.get('default.Project').metadata).toBe(baseline.metadata);
    });

    it('wraps composer errors with resource/family identity and publishes nothing after a failure', () => {
        const cause = new Error('Invalid customization');
        const resources = registry([
            defineResource({ model: 'Project' }),
            defineResource({
                model: 'Other',
                schemas: {
                    create() {
                        throw cause;
                    },
                },
            }),
        ]);
        expect(() => resources.initialize([model(), model('Other')])).toThrow(
            expect.objectContaining({ code: 'RESOURCE_SCHEMA_FAILED', cause }),
        );
        expect(() => resources.all()).toThrow(expect.objectContaining({ code: 'RESOURCE_REGISTRY_NOT_READY' }));
    });

    it('rejects invalid composer results and invalid generated schema families', () => {
        const invalid = registry([
            defineResource({
                model: 'Project',
                schemas: { create: (() => z.string()) as unknown as (schema: z.ZodObject) => z.ZodObject },
            }),
        ]);
        expect(() => invalid.initialize([model()])).toThrow(
            expect.objectContaining({ code: 'RESOURCE_SCHEMA_FAILED' }),
        );
        expect(() => registry().initialize([{ ...model(), read: z.string() } as unknown as ResourceModel])).toThrow(
            expect.objectContaining({ code: 'RESOURCE_MODELS_INVALID' }),
        );
        expect(() => registry().initialize([model(), model()])).toThrow(
            expect.objectContaining({ code: 'RESOURCE_MODELS_INVALID' }),
        );
        expect(() =>
            registry().initialize([{ ...model(), metadata: { ...model().metadata, provider: 'mongodb' } }]),
        ).toThrow(expect.objectContaining({ code: 'RESOURCE_MODELS_INVALID' }));
    });
});

describe('Application resource bootstrap', () => {
    it('loads models before every configure/ready hook and exposes the registry in context', async () => {
        const events: string[] = [];
        const application = defineApplication({
            databases: DATABASES,
            apps: [
                defineApp({
                    name: 'projects',
                    dependsOn: ['users'],
                    resources: [defineResource({ model: 'Project' })],
                    configure({ resources }) {
                        events.push(`configure:${resources.get('default.Project').model}`);
                    },
                }),
                defineApp({
                    name: 'users',
                    resources: [defineResource({ model: 'User', api: false })],
                    ready({ resources, application }) {
                        expect(resources).toBe(application.resources);
                        events.push('ready:users');
                    },
                }),
            ],
            resourceModels: async (application) => {
                expect(application.apps.all().map((app) => app.name)).toEqual(['users', 'projects']);
                events.push('load');
                return [model('User'), model()];
            },
        });
        await application.start();
        await application.start();
        expect(events).toEqual(['load', 'configure:Project', 'ready:users']);
        expect(application.resources.all().map((resource) => resource.identity)).toEqual([
            'default.User',
            'default.Project',
        ]);
        await application.shutdown();
    });

    it('fails startup on a missing model before invoking any hook', async () => {
        const hook = vi.fn();
        const application = defineApplication({
            databases: DATABASES,
            resources: [defineResource({ model: 'Missing' })],
            apps: [{ name: 'projects', configure: hook, ready: hook, shutdown: hook }],
            resourceModels: [model()],
        });
        await expect(application.start()).rejects.toThrow('default.Missing');
        expect(application.state).toBe('failed');
        expect(hook).not.toHaveBeenCalled();
        await application.shutdown();
        expect(hook).not.toHaveBeenCalled();
    });

    it('fails closed when resources exist without supplying models', async () => {
        const application = defineApplication({
            databases: DATABASES,
            apps: [{ name: 'projects', resources: [defineResource({ model: 'Project' })] }],
        });
        await expect(application.start()).rejects.toMatchObject({ code: 'RESOURCE_MODEL_MISSING' });
    });

    it('preserves model-loader failures without invoking app hooks', async () => {
        const cause = new Error('Emit failed');
        const configure = vi.fn();
        const application = defineApplication({
            databases: DATABASES,
            apps: [{ name: 'projects', configure }],
            resourceModels() {
                throw cause;
            },
        });
        await expect(application.start()).rejects.toMatchObject({ code: 'RESOURCE_MODELS_LOAD_FAILED', cause });
        expect(application.state).toBe('failed');
        expect(configure).not.toHaveBeenCalled();
    });

    it('snapshots app/root resource and model arrays against later caller mutation', async () => {
        const definitions = [defineResource({ model: 'Project' })];
        const app = defineApp({ name: 'projects', resources: definitions });
        const rootResources = [defineResource({ model: 'User' })];
        const models = [model(), model('User')];
        const application = defineApplication({
            databases: DATABASES,
            apps: [app],
            resources: rootResources,
            resourceModels: models,
        });
        definitions.length = 0;
        rootResources.length = 0;
        models.length = 0;
        await application.start();
        expect(application.resources.all().map((resource) => resource.identity)).toEqual([
            'default.User',
            'default.Project',
        ]);
        expect(Object.isFrozen(app.resources)).toBe(true);
        await application.shutdown();
    });

    it('rejects duplicate root/app resource registrations at construction', () => {
        const project = defineResource({ model: 'Project' });
        expect(() =>
            defineApplication({
                databases: DATABASES,
                resources: [project],
                apps: [{ name: 'projects', resources: [project] }],
            }),
        ).toThrow(expect.objectContaining({ code: 'RESOURCE_DUPLICATE' }));
    });
});
