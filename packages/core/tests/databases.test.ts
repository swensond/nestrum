import { describe, expect, it } from 'vitest';
import { AppError, DatabaseRegistry, DatabaseRegistryError, defineApp, defineApplication, modelIdentity } from '../src/index.js';
import type { ApplicationConfig, DatabaseDefinition, DatabaseEntry } from '../src/index.js';

const SQL_DATABASE = { kind: 'prisma', provider: 'postgresql', connection: 'postgresql://localhost/nestrum_test' } as const satisfies DatabaseDefinition;
const MONGO_DATABASE = { kind: 'prisma', provider: 'mongodb', connection: 'mongodb://localhost/nestrum_documents' } as const satisfies DatabaseDefinition;

describe('DatabaseRegistry', () => {
    it('resolves default and named definitions independently', () => {
        const registry = new DatabaseRegistry({ default: SQL_DATABASE, documents: MONGO_DATABASE });

        expect(registry.get()).toEqual(SQL_DATABASE);
        expect(registry.get('default')).toEqual(SQL_DATABASE);
        expect(registry.get('documents')).toEqual(MONGO_DATABASE);
        expect(registry.has('documents')).toBe(true);
        expect(registry.has('missing')).toBe(false);
        expect(registry.names()).toEqual(['default', 'documents']);
    });

    it('rejects unknown lookup with a coded framework error', () => {
        const registry = new DatabaseRegistry({ default: SQL_DATABASE });

        expect(() => registry.get('documents')).toThrow(expect.objectContaining({ code: 'DATABASE_NOT_FOUND' }));
        expect(() => registry.get('documents')).toThrow(AppError);
    });

    it.each([{}, { documents: MONGO_DATABASE }])('requires default in the registry: %j', (config) => {
        expect(() => new DatabaseRegistry(config)).toThrow(expect.objectContaining({ code: 'DEFAULT_DATABASE_REQUIRED' }));
    });

    it('accepts entries while rejecting duplicate names before they can be overwritten', () => {
        const entries: DatabaseEntry[] = [['default', SQL_DATABASE], ['documents', MONGO_DATABASE]];
        expect(new DatabaseRegistry(entries).get('documents')).toEqual(MONGO_DATABASE);
        entries.push(['default', MONGO_DATABASE]);

        expect(() => new DatabaseRegistry(entries)).toThrow(expect.objectContaining({ code: 'DUPLICATE_DATABASE' }));
    });

    it('snapshots definitions and names without freezing caller-owned configuration', () => {
        const database: DatabaseDefinition = { ...SQL_DATABASE };
        const config = { default: database, documents: { ...MONGO_DATABASE } };
        const registry = new DatabaseRegistry(config);
        config.default = MONGO_DATABASE;
        Object.assign(database, { connection: 'changed' });
        Object.assign(config.documents, { provider: 'postgresql' });

        expect(registry.get()).toEqual(SQL_DATABASE);
        expect(registry.get('documents')).toEqual(MONGO_DATABASE);
        expect(Object.isFrozen(registry.get())).toBe(true);
        expect(Object.isFrozen(registry.names())).toBe(true);
        expect(Object.isFrozen(database)).toBe(false);
        expect(Object.isFrozen(config)).toBe(false);
    });

    it('uses only own entries, including for the required default', () => {
        const inherited = Object.create({ default: SQL_DATABASE }) as Record<string, DatabaseDefinition>;
        inherited.documents = MONGO_DATABASE;

        expect(() => new DatabaseRegistry(inherited)).toThrow(expect.objectContaining({ code: 'DEFAULT_DATABASE_REQUIRED' }));
    });

    it('handles identifier names that overlap object prototype properties', () => {
        const registry = new DatabaseRegistry({ default: SQL_DATABASE, constructor: MONGO_DATABASE, ['__proto__']: MONGO_DATABASE });

        expect(registry.get('constructor')).toEqual(MONGO_DATABASE);
        expect(registry.get('__proto__')).toEqual(MONGO_DATABASE);
        expect(registry.has('toString')).toBe(false);
    });

    it.each(['', ' default', 'default ', 'document.store', 'document-store', '1database', 'documents/other'])('rejects invalid database name %j', (name) => {
        expect(() => new DatabaseRegistry({ default: SQL_DATABASE, [name]: MONGO_DATABASE })).toThrow(expect.objectContaining({ code: 'INVALID_DATABASE_NAME' }));
    });

    it.each([null, undefined, 42, 'databases', [['default']], [[null, SQL_DATABASE]]])('rejects malformed configuration: %j', (config) => {
        expect(() => new DatabaseRegistry(config as unknown as Record<string, DatabaseDefinition>)).toThrow(DatabaseRegistryError);
    });

    it.each([null, {}, { ...SQL_DATABASE, kind: 'other' }, { ...SQL_DATABASE, provider: 'mysql' }, { ...SQL_DATABASE, connection: '' }, { ...SQL_DATABASE, connection: '  ' }])('revalidates raw definitions: %j', (database) => {
        expect(() => new DatabaseRegistry({ default: database as DatabaseDefinition })).toThrow(expect.objectContaining({ code: 'INVALID_DATABASE_CONFIG' }));
    });
});

describe('modelIdentity', () => {
    it('defaults to default and supports distinct named database identities', () => {
        expect(modelIdentity('Project')).toBe('default.Project');
        expect(modelIdentity('Project', 'default')).toBe('default.Project');
        expect(modelIdentity('Article', 'documents')).toBe('documents.Article');
        expect(modelIdentity('Project', 'documents')).not.toBe(modelIdentity('Project'));
        expect(modelIdentity('_Event2', 'identity_2')).toBe('identity_2._Event2');
    });

    it.each(['', 'Project ', ' Project', 'default.Project', 'Project/Other', '1Project'])('rejects ambiguous/invalid model name %j', (model) => {
        expect(() => modelIdentity(model)).toThrow(expect.objectContaining({ code: 'INVALID_MODEL_NAME' }));
    });

    it('rejects a database name that would make identity ambiguous', () => {
        expect(() => modelIdentity('Project', 'a.b')).toThrow(expect.objectContaining({ code: 'INVALID_DATABASE_NAME' }));
    });
});

describe('Application database integration', () => {
    it('makes the same registry available in all app hooks and on the application', async () => {
        const registries: DatabaseRegistry[] = [];
        const application = defineApplication({ databases: { default: SQL_DATABASE, documents: MONGO_DATABASE }, apps: [defineApp({
            name: 'projects',
            configure({ databases }) { registries.push(databases); },
            ready({ databases }) { registries.push(databases); },
            shutdown({ databases }) { registries.push(databases); }
        })] });

        expect(application.databases.get('documents')).toEqual(MONGO_DATABASE);
        await application.start();
        await application.shutdown();
        expect(registries).toHaveLength(3);
        for (const registry of registries) {
            expect(registry).toBe(application.databases);
        }
    });

    it('rejects missing default during construction, before app hooks run', () => {
        const events: string[] = [];
        const apps = [defineApp({ name: 'projects', configure() { events.push('configure'); }, ready() { events.push('ready'); } })];

        // @ts-expect-error The required default is also enforced for typed application configuration.
        expect(() => defineApplication({ apps, databases: { documents: MONGO_DATABASE } })).toThrow(expect.objectContaining({ code: 'DEFAULT_DATABASE_REQUIRED' }));
        expect(events).toEqual([]);
    });

    it('rejects omitted or invalid database configuration from untyped callers', () => {
        expect(() => defineApplication({ apps: [] } as unknown as ApplicationConfig)).toThrow(expect.objectContaining({ code: 'INVALID_DATABASE_CONFIG' }));
        expect(() => defineApplication({ apps: [], databases: { default: { ...SQL_DATABASE, provider: 'unknown' } } } as unknown as ApplicationConfig)).toThrow(DatabaseRegistryError);
    });
});
