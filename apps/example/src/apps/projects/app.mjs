import { allow, defineApp, defineResource, deny, eq } from '@nestrum/core';
import { z } from 'zod';

export const Project = defineResource({
    model: 'Project',
    // Opt in to API keys next to browser sessions. Keys need the projects:read / projects:write scopes by default.
    api: { list: true, retrieve: true, create: true, update: true, delete: true, auth: ['session', 'api-key'] },
    managers: { active: (query) => query.filter({ status: 'active' }) },
    schemas: {
        create: (schema) => schema.extend({ name: z.string().min(3), status: z.enum(['active', 'archived']) }),
        update: (schema) =>
            schema
                .omit({ ownerId: true })
                .extend({ name: z.string().min(3).optional(), status: z.enum(['active', 'archived']).optional() }),
    },
});
// A human session owns records as itself; an API key acts for the owner recorded on the key, with only its scopes.
const ownerOf = (subject) => (subject.type === 'api-key' ? subject.owner.id : subject.id);
export const projectsPolicy = {
    resource: Project.identity,
    authorize: ({ subject }) => (typeof subject.id === 'string' ? allow() : deny('ANONYMOUS')),
    actions: {
        read: { scope: ({ subject }) => eq('ownerId', ownerOf(subject)) },
        create: {
            // Discovery omits input; inserts still require validated, owner-matching data.
            authorize: ({ subject, input }) =>
                input === undefined || input.ownerId === ownerOf(subject) ? allow() : deny('NOT_OWNER'),
        },
        update: { scope: ({ subject }) => eq('ownerId', ownerOf(subject)) },
        // Keys may read and write but never delete, even when their scope allows it.
        delete: {
            authorize: ({ subject }) => (subject.type === 'api-key' ? deny('KEYS_CANNOT_DELETE') : allow()),
            scope: ({ subject }) => eq('ownerId', ownerOf(subject)),
        },
        archive: { operations: ['update'], scope: ({ subject }) => eq('ownerId', ownerOf(subject)) },
    },
};
export function projectsApp(events) {
    return defineApp({
        name: 'projects',
        dependsOn: ['nestrum.auth'],
        resources: [Project],
        policies: [projectsPolicy],
        prisma: { default: ['src/apps/projects/prisma'] },
        configure: () => {
            events.push('configure:projects');
        },
        ready: () => {
            events.push('ready:projects');
        },
        shutdown: () => {
            events.push('shutdown:projects');
        },
    });
}
