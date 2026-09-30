import { describe, expect, it } from 'vitest';
import type { ApplicationConfig, DatabaseDefinition } from '../src/index.js';
import {
    DatabaseRegistryError,
    defineApp,
    defineApplication,
    modelIdentity,
    validateDatabaseDefinition,
} from '../src/index.js';

const SQL_DATABASE = {
    kind: 'prisma',
    provider: 'postgresql',
    connection: 'postgresql://localhost/nestrum_test',
} as const satisfies DatabaseDefinition;

describe('database definition', () => {
    it('accepts the one supported PostgreSQL Prisma definition', () => {
        expect(() => validateDatabaseDefinition(SQL_DATABASE)).not.toThrow();
    });

    it.each([
        null,
        undefined,
        42,
        {},
        { ...SQL_DATABASE, kind: 'other' },
        { ...SQL_DATABASE, provider: 'mysql' },
        { ...SQL_DATABASE, provider: 'mongodb' },
        { ...SQL_DATABASE, connection: '' },
        { ...SQL_DATABASE, connection: '  ' },
        { ...SQL_DATABASE, connection: ' postgresql://localhost/x' },
    ])('rejects a malformed definition: %j', (database) => {
        expect(() => validateDatabaseDefinition(database)).toThrow(
            expect.objectContaining({ code: 'INVALID_DATABASE_CONFIG' }),
        );
    });
});

describe('modelIdentity', () => {
    it('is the model name', () => {
        expect(modelIdentity('Project')).toBe('Project');
        expect(modelIdentity('_Event2')).toBe('_Event2');
    });

    it.each(['', 'Project ', ' Project', 'default.Project', 'Project/Other', '1Project'])(
        'rejects ambiguous/invalid model name %j',
        (model) => {
            expect(() => modelIdentity(model)).toThrow(expect.objectContaining({ code: 'INVALID_MODEL_NAME' }));
        },
    );
});

describe('Application database integration', () => {
    it('exposes the same frozen snapshot on the application and in all app hooks', async () => {
        const seen: DatabaseDefinition[] = [];
        const input: DatabaseDefinition = { ...SQL_DATABASE };
        const application = defineApplication({
            database: input,
            apps: [
                defineApp({
                    name: 'projects',
                    configure({ database }) {
                        seen.push(database);
                    },
                    ready({ database }) {
                        seen.push(database);
                    },
                    shutdown({ database }) {
                        seen.push(database);
                    },
                }),
            ],
        });
        Object.assign(input, { connection: 'changed' });

        expect(application.database).toEqual(SQL_DATABASE);
        expect(Object.isFrozen(application.database)).toBe(true);
        expect(Object.isFrozen(input)).toBe(false);
        await application.start();
        await application.shutdown();
        expect(seen).toHaveLength(3);
        for (const database of seen) {
            expect(database).toBe(application.database);
        }
    });

    it('rejects omitted or invalid database configuration before app hooks run', () => {
        const events: string[] = [];
        const apps = [
            defineApp({
                name: 'projects',
                configure() {
                    events.push('configure');
                },
            }),
        ];

        // @ts-expect-error The database is required for typed application configuration.
        expect(() => defineApplication({ apps })).toThrow(DatabaseRegistryError);
        expect(() =>
            defineApplication({
                apps,
                database: { ...SQL_DATABASE, provider: 'unknown' },
            } as unknown as ApplicationConfig),
        ).toThrow(expect.objectContaining({ code: 'INVALID_DATABASE_CONFIG' }));
        expect(events).toEqual([]);
    });
});
