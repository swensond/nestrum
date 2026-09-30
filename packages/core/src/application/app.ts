import { definePolicy } from '#core/authorization/authorization';
import { PolicyError } from '#core/authorization/authorization.errors';
import { defineResource } from '#core/resource/resource';
import { ResourceError } from '#core/resource/resource.errors';
import { AppRegistryError } from './application.errors.js';
import type { AppDefinition } from './application.types.js';

export function defineApp(definition: AppDefinition): AppDefinition {
    if (typeof definition.name !== 'string' || !definition.name || definition.name.trim() !== definition.name) {
        throw new AppRegistryError(
            'INVALID_APP_NAME',
            'App names must be nonempty and have no leading or trailing whitespace.',
        );
    }

    if (definition.resources !== undefined && !Array.isArray(definition.resources)) {
        throw new ResourceError('RESOURCE_CONFIG_INVALID', `App ${definition.name} resources must be an array.`);
    }
    if (definition.policies !== undefined && !Array.isArray(definition.policies)) {
        throw new PolicyError('POLICY_INVALID', `App ${definition.name} policies must be an array.`);
    }
    if (
        definition.prismaSource !== undefined &&
        (typeof definition.prismaSource !== 'string' || !definition.prismaSource.trim())
    ) {
        throw new AppRegistryError(
            'INVALID_PRISMA_CONTRIBUTION',
            'Inline Prisma contributions must be nonempty source text.',
        );
    }
    if (definition.prisma !== undefined) {
        if (
            !Array.isArray(definition.prisma) ||
            definition.prisma.length === 0 ||
            definition.prisma.some((path: unknown) => typeof path !== 'string' || !path.trim())
        ) {
            throw new AppRegistryError(
                'INVALID_PRISMA_CONTRIBUTION',
                `App "${definition.name}" Prisma contributions must be a nonempty list of file or directory paths.`,
            );
        }
    }

    return Object.freeze({
        ...definition,
        ...(definition.policies === undefined
            ? {}
            : { policies: Object.freeze(Array.from(definition.policies, definePolicy)) }),
        ...(definition.resources === undefined
            ? {}
            : { resources: Object.freeze(Array.from(definition.resources, defineResource)) }),
        ...(definition.dependsOn === undefined ? {} : { dependsOn: Object.freeze([...definition.dependsOn]) }),
        ...(definition.prisma === undefined ? {} : { prisma: Object.freeze([...definition.prisma]) }),
    });
}
