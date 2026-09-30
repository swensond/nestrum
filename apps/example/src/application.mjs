import { readFile } from 'node:fs/promises';
import { defineAdmin, roleBasedAdminPolicies } from '@nestrum/admin';
import { defineAuth } from '@nestrum/auth';
import { defineApplication, defineFeatureFlags } from '@nestrum/core';
import postgres from '@nestrum/example-postgres';
import { defineFeatures } from '@nestrum/features';
import { compileModelMetadata } from '@nestrum/prisma';
import { createPrismaQueryBackend } from '@nestrum/prisma/querysets';
import { generateModelSchemas } from '@nestrum/zod';
import { Article, articlesApp } from './apps/articles/app.mjs';
import { Project, projectsApp } from './apps/projects/app.mjs';

// Feature flags answer "is this capability switched on?"; ABAC still decides who may use it. Overrides live in
// Nestrum's FeatureOverride table in the application's database and are managed at /admin/features.
export const features = defineFeatureFlags({
    newDashboard: { default: false, exposeToClient: true, description: 'Redesigned dashboard for the consumer UI' },
    experimentalSearch: { default: false, description: 'Server-only search experiment' },
});

export function createExample({
    connection,
    baseURL = 'http://127.0.0.1:3100',
    events = [],
    secret = process.env.AUTH_SECRET,
} = {}) {
    if (!connection || !secret) {
        throw new Error('Example requires an explicit database connection and AUTH_SECRET.');
    }
    let client;
    let resourceModels = [];
    const auth = defineAuth({
        baseURL,
        secret,
        prisma: () => ({
            collections: client.orm.public,
            // Atomic units of work (SSO resolveUser needs them); PostgreSQL clients provide transactions.
            transaction: (run) => client.transaction((tx) => run(tx.orm.public)),
        }),
        // Enterprise SSO (OIDC and SAML 2.0): providers are managed at /admin/auth/sso. The identity migration adds
        // the SsoProvider table. Identity providers on private networks would be listed in `trustedIdpOrigins`.
        sso: { enabled: true },
    });
    const featureFlags = defineFeatures({
        flags: features,
        environment: 'integration',
        prisma: () => ({ collection: client.orm.public.FeatureOverride }),
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
        listDisplay: ['id', 'title', 'status'],
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
        database: { kind: 'prisma', provider: 'postgresql', connection },
        auth,
        admin,
        features: featureFlags,
        apps: [articlesApp(events), projectsApp(events)],
        // `staff` and `admin` roles enter administration; only `admin` manages users (see the admin interface).
        policies: roleBasedAdminPolicies(),
        // Contracts are emitted by `nestrum build`/`nestrum dev`; startup only reads them. The application module is
        // bundled into `<build>/server/`, so the build directory is its parent.
        async prepare() {
            const buildDir = new URL('../', import.meta.url);
            const contractJson = JSON.parse(await readFile(new URL('contracts/database.json', buildDir), 'utf8'));
            client = postgres({ contractJson, url: connection });
            resourceModels = compileModelMetadata({ provider: 'postgresql', contract: contractJson })
                .filter((model) => [Project.identity, Article.identity].includes(model.identity))
                .map((model) => {
                    const collection = client.orm.public[model.name];

                    return {
                        ...generateModelSchemas(model),
                        queryBackend: { ...createPrismaQueryBackend(collection), raw: collection },
                    };
                });
            events.push('prepared');
        },
        resourceModels: () => resourceModels,
        databaseLifecycle: {
            connect: async () => {
                await client.connect();
                events.push('connect');
            },
            disconnect: async () => {
                await client?.close();
                events.push('disconnect');
            },
        },
    });

    return {
        application,
        events,
        get client() {
            return client;
        },
    };
}
