import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineAdmin } from '@nestrum/admin';
import { defineAuth, field } from '@nestrum/auth';
import { allow, defineApplication, deny } from '@nestrum/core';
import mongo, { bindMongoCollection } from '@nestrum/example-mongo';
import postgres from '@nestrum/example-postgres';
import { compileModelMetadata } from '@nestrum/prisma';
import { generatePrismaContracts } from '@nestrum/prisma/node';
import { createPrismaQueryBackend } from '@nestrum/prisma/querysets';
import { generateModelSchemas } from '@nestrum/zod';
import { Article, articlesApp } from './apps/articles/app.mjs';
import { Project, projectsApp } from './apps/projects/app.mjs';

export const ROOT_DIR = fileURLToPath(new URL('../', import.meta.url));
export const providerDirectory = (database) =>
    resolve(ROOT_DIR, database === 'documents' ? '../example-mongo' : '../example-postgres');

export function createExample({
    connections,
    baseURL = 'http://127.0.0.1:3100',
    outputDir = '.nestrum/contracts',
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
        extend: { user: { staff: field.boolean().default(false) } },
        subjectFactory: ({ user }) => ({ id: user.id, anonymous: false, staff: user.staff === true }),
        prisma: () => ({ database: 'identity', collections: clients.get('identity').orm.public }),
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
        apps: [articlesApp(events), projectsApp(events)],
        policies: [
            {
                resource: 'admin.access',
                actions: {
                    access: { authorize: ({ subject }) => (subject.staff === true ? allow() : deny('NOT_STAFF')) },
                },
            },
        ],
        async prepare(app) {
            const metadata = [];
            for (const database of app.databases.names()) {
                const generated = await generatePrismaContracts(app, {
                    rootDir: ROOT_DIR,
                    database,
                    outputDir: resolve(providerDirectory(database), outputDir),
                });
                const contract = generated.contracts[0];
                const contractJson = JSON.parse(await readFile(contract.contractPath, 'utf8'));
                clients.set(
                    contract.database,
                    contract.provider === 'postgresql'
                        ? postgres({ contractJson, url: connections[contract.database] })
                        : mongo({ contractJson, url: connections[contract.database] }),
                );
                metadata.push(
                    ...compileModelMetadata({
                        database: contract.database,
                        provider: contract.provider,
                        contract: contractJson,
                    }),
                );
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
