import { DatabaseRegistryError, defineApp, defineApplication } from '@nestrum/core';
import { describe, expect, it } from 'vitest';
import type { PrismaDatabaseConfig } from '../src/index.js';
import { prismaDatabase } from '../src/index.js';

describe('prismaDatabase', () => {
    it('creates frozen Prisma definitions without modifying caller configuration', () => {
        const config: PrismaDatabaseConfig = {
            provider: 'postgresql',
            connection: 'postgresql://localhost/nestrum_test',
        };
        const definition = prismaDatabase(config);

        expect(definition).toEqual({ kind: 'prisma', ...config });
        expect(Object.isFrozen(definition)).toBe(true);
        expect(Object.isFrozen(config)).toBe(false);
        Object.assign(config, { connection: 'changed' });
        expect(definition.connection).toBe('postgresql://localhost/nestrum_test');
    });

    it('accepts alternate PostgreSQL connection schemes without connecting', () => {
        expect(
            prismaDatabase({ provider: 'postgresql', connection: 'prisma+postgres://example.test/?api_key=test' })
                .provider,
        ).toBe('postgresql');
    });

    it.each(['', ' ', ' postgresql://localhost/test', 'postgresql://localhost/test ', undefined, 42])(
        'rejects invalid connection %j',
        (connection) => {
            expect(() =>
                prismaDatabase({ provider: 'postgresql', connection } as unknown as PrismaDatabaseConfig),
            ).toThrow(DatabaseRegistryError);
        },
    );

    it.each(['mysql', 'sqlite', 'mongodb', 'unknown', undefined])(
        'rejects provider outside the MVP configuration contract: %j',
        (provider) => {
            expect(() => prismaDatabase({ provider, connection: 'test' } as unknown as PrismaDatabaseConfig)).toThrow(
                DatabaseRegistryError,
            );
        },
    );

    it('does not include connection credentials in validation errors', () => {
        const connection = ' postgresql://secret-user:secret-password@example.test/test';

        expect(() => prismaDatabase({ provider: 'postgresql', connection })).toThrow(
            'Database connection must be a nonempty string without surrounding whitespace.',
        );
    });

    it('composes with the application and lifecycle using public package imports', async () => {
        const providers: string[] = [];
        const application = defineApplication({
            database: prismaDatabase({ provider: 'postgresql', connection: 'postgresql://localhost/nestrum_test' }),
            apps: [
                defineApp({
                    name: 'articles',
                    configure({ database }) {
                        providers.push(database.provider);
                    },
                }),
            ],
        });

        await application.start();
        expect(providers).toEqual(['postgresql']);
        expect(application.database.provider).toBe('postgresql');
        await application.shutdown();
    });
});
