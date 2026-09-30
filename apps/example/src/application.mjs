import { readFile } from 'node:fs/promises';
import { defineAdmin, roleBasedAdminPolicies } from '@nestrum/admin';
import { defineAuth } from '@nestrum/auth';
import { defineApplication, defineFeatureFlags } from '@nestrum/core';
import mongo, { bindMongoCollection } from '@nestrum/example-mongo';
import postgres from '@nestrum/example-postgres';
import { defineFeatures } from '@nestrum/features';
import { compileModelMetadata } from '@nestrum/prisma';
import { createPrismaQueryBackend } from '@nestrum/prisma/querysets';
import { generateModelSchemas } from '@nestrum/zod';
import { Article, articlesApp } from './apps/articles/app.mjs';
import { Project, projectsApp } from './apps/projects/app.mjs';

// Feature flags answer "is this capability switched on?"; ABAC still decides who may use it. Overrides live in
// Nestrum's FeatureOverride table on the identity database and are managed at /admin/features.
export const features = defineFeatureFlags({
    newDashboard: { default: false, exposeToClient: true, description: 'Redesigned dashboard for the consumer UI' },
    experimentalSearch: { default: false, description: 'Server-only search experiment' },
});

export function createExample({
    connections,
    baseURL = 'http://127.0.0.1:3100',
    events = [],
    secret = process.env.AUTH_SECRET,
} = {}) {
    if (!connections || !secret) {
        throw new Error('Example requires explicit database connections and AUTH_SECRET.');
    }
    const clients = new Map();
    let resourceModels = [];
    const auth = defineAuth({
        database: 'identity',
        baseURL,
        secret,
        prisma: () => ({ database: 'identity', collections: clients.get('identity').orm.public }),
    });
    const featureFlags = defineFeatures({
        flags: features,
        database: 'identity',
        environment: 'integration',
        prisma: () => ({ database: 'identity', collection: clients.get('identity').orm.public.FeatureOverride }),
    });
    const admin = defineAdmin();
    admin.register(Project, {
        listDisplay: ['id', 'name', 'status'],
        fields: { description: { widget: 'textarea' } },
        actions: {
            archive: {
                label: 'Archive',
                handler: async ({ objects }) => {
                    await objects.update({ status: 'archived' });
                },
            },
        },
    });
    admin.register(Article, {
        listDisplay: ['_id', 'title', 'status'],
        fields: { body: { widget: 'textarea' } },
        actions: {
            archive: {
                label: 'Archive',
                handler: async ({ objects }) => {
                    await objects.update({ status: 'archived' });
                },
            },
        },
    });
    const application = defineApplication({
        databases: {
            default: { kind: 'prisma', provider: 'postgresql', connection: connections.default },
            documents: { kind: 'prisma', provider: 'mongodb', connection: connections.documents },
            identity: { kind: 'prisma', provider: 'postgresql', connection: connections.identity },
        },
        auth,
        admin,
        features: featureFlags,
        apps: [articlesApp(events), projectsApp(events)],
        // `staff` and `admin` roles enter administration; only `admin` manages users (see the admin interface).
        policies: roleBasedAdminPolicies(),
        // Contracts are emitted by `nestrum build`/`nestrum dev`; startup only reads them. The application module is
        // bundled into `<build>/server/`, so the build directory is its parent.
        async prepare(app) {
            const buildDir = new URL('../', import.meta.url);
            const metadata = [];
            for (const database of app.databases.names()) {
                const provider = app.databases.get(database).provider;
                const contractJson = JSON.parse(
                    await readFile(new URL(`contracts/${database}.json`, buildDir), 'utf8'),
                );
                clients.set(
                    database,
                    provider === 'postgresql'
                        ? postgres({ contractJson, url: connections[database] })
                        : mongo({ contractJson, url: connections[database] }),
                );
                metadata.push(...compileModelMetadata({ database, provider, contract: contractJson }));
            }
            resourceModels = metadata
                .filter((model) => [Project.identity, Article.identity].includes(model.identity))
                .map((model) => {
                    const client = clients.get(model.database);
                    const collection =
                        model.provider === 'postgresql' ? client.orm.public[model.name] : client.orm[model.name];
                    const binding = model.provider === 'mongodb' ? bindMongoCollection(collection, model) : undefined;
                    const options =
                        model.provider === 'postgresql'
                            ? { provider: 'postgresql' }
                            : {
                                  provider: 'mongodb',
                                  count: async (predicate) => {
                                      const result = await (await client.runtime()).query(
                                          client.query
                                              .from(model.name)
                                              .match(binding.encodeFilter(predicate))
                                              .count('total')
                                              .build(),
                                      );
                                      return result[0]?.total ?? 0;
                                  },
                              };
                    return {
                        ...generateModelSchemas(model),
                        queryBackend: {
                            ...createPrismaQueryBackend(binding?.collection ?? collection, options),
                            raw: collection,
                        },
                    };
                });
            events.push('prepared');
        },
        resourceModels: () => resourceModels,
        databaseLifecycle: Object.fromEntries(
            ['default', 'documents', 'identity'].map((name) => [
                name,
                {
                    connect: async () => {
                        await clients.get(name).connect();
                        events.push(`connect:${name}`);
                    },
                    disconnect: async () => {
                        await clients.get(name)?.close();
                        events.push(`disconnect:${name}`);
                    },
                },
            ]),
        ),
    });

    return { application, clients, events };
}
