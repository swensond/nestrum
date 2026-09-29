import { AppRegistryError } from './application.errors.js';
import { defineResource } from '#core/resource/resource';
import { ResourceError } from '#core/resource/resource.errors';
import type { AppDefinition } from './application.types.js';
import { definePolicy } from '#core/authorization/authorization';
import { PolicyError } from '#core/authorization/authorization.errors';

export function defineApp(definition: AppDefinition): AppDefinition {
    if (typeof definition.name !== 'string' || !definition.name || definition.name.trim() !== definition.name) {
        throw new AppRegistryError('INVALID_APP_NAME', 'App names must be nonempty and have no leading or trailing whitespace.');
    }

    if (definition.resources !== undefined && !Array.isArray(definition.resources)) {
        throw new ResourceError('RESOURCE_CONFIG_INVALID', `App ${definition.name} resources must be an array.`);
    }
    const prisma: Record<string, readonly string[]> = Object.create(null) as Record<string, readonly string[]>;
    const prismaSource: Record<string, string> = Object.create(null) as Record<string, string>;
    if (definition.prismaSource !== undefined) {
        if (!definition.prismaSource || typeof definition.prismaSource !== 'object' || Array.isArray(definition.prismaSource)) {
            throw new AppRegistryError('INVALID_PRISMA_CONTRIBUTION', 'Inline Prisma contributions must be a database-to-source object.');
        }
        for (const [database, source] of Object.entries(definition.prismaSource)) {
            if (typeof source !== 'string' || !source.trim()) { throw new AppRegistryError('INVALID_PRISMA_CONTRIBUTION', 'Inline Prisma contributions must contain nonempty source.'); }
            prismaSource[database] = source;
        }
    }
    if (definition.policies !== undefined && !Array.isArray(definition.policies)) {
        throw new PolicyError('POLICY_INVALID', `App ${definition.name} policies must be an array.`);
    }

    if (definition.prisma !== undefined) {
        if (definition.prisma === null || typeof definition.prisma !== 'object' || Array.isArray(definition.prisma)) {
            throw new AppRegistryError('INVALID_PRISMA_CONTRIBUTION', `App "${definition.name}" Prisma contributions must be a database-to-path-list object.`);
        }

        for (const [database, paths] of Object.entries(definition.prisma)) {
            if (!Array.isArray(paths) || paths.length === 0 || paths.some((path: unknown) => typeof path !== 'string' || !path.trim())) {
                throw new AppRegistryError('INVALID_PRISMA_CONTRIBUTION', `App "${definition.name}" Prisma contributions for "${database}" must contain nonempty file or directory paths.`);
            }

            prisma[database] = Object.freeze([...paths]);
        }
    }

    return Object.freeze({
        ...definition,
        ...(definition.prismaSource === undefined ? {} : { prismaSource: Object.freeze(prismaSource) }),
        ...(definition.policies === undefined ? {} : { policies: Object.freeze(Array.from(definition.policies, definePolicy)) }),
        ...(definition.resources === undefined ? {} : { resources: Object.freeze(Array.from(definition.resources, defineResource)) }),
        ...(definition.dependsOn === undefined ? {} : { dependsOn: Object.freeze([...definition.dependsOn]) }),
        ...(definition.prisma === undefined ? {} : { prisma: Object.freeze(prisma) })
    });
}
