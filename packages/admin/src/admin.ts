import type { AdminApi, AdminDefinition, AdminRequestContext, Application } from '@nestrum/core';
import { AdminError } from '@nestrum/core';
import type { AdminOptions } from './registry.js';
import { AdminRegistry } from './registry.js';
import { resolveAdminEntries } from './resolve.js';
import { ADMIN_BASE_PATH, createAdminRouter } from './router.js';
import { resolveTwoFactorPolicy } from './security.js';

export function defineAdmin(options: AdminOptions = {}): AdminDefinition {
    const registry = new AdminRegistry(options);
    const security = Object.freeze({ twoFactor: resolveTwoFactorPolicy(options.security) });
    const transport = Object.freeze({
        ...(options.temporal === undefined ? {} : { temporal: Object.freeze({ ...options.temporal }) }),
    });
    let initialized = false;
    const definition: AdminDefinition = Object.freeze({
        kind: 'nestrum-admin',
        basePath: ADMIN_BASE_PATH,
        security,
        allowedOrigins: registry.origins,
        register(resource, configuration) {
            registry.register(resource, configuration);

            return definition;
        },
        async initialize(application: Application): Promise<AdminApi> {
            if (initialized || !application.auth) {
                throw new AdminError(
                    'ADMIN_CONFIG_INVALID',
                    'Admin requires authentication and can initialize only once.',
                );
            }
            registry.seal();
            initialized = true;
            const { registrations, slugs } = registry.state;
            const entries = resolveAdminEntries(registrations, application, slugs, transport);
            const router = createAdminRouter(
                entries,
                application,
                { allowedOrigins: registry.origins },
                transport,
                security.twoFactor,
            );

            return Object.freeze({
                basePath: ADMIN_BASE_PATH,
                async handle(request: Request, context: AdminRequestContext) {
                    return router.fetch(request, { requestContext: context });
                },
            });
        },
    });

    return definition;
}
