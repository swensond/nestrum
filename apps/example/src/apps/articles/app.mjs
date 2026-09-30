import { allow, defineApp, defineResource, deny, eq } from '@nestrum/core';
import { z } from 'zod';

export const Article = defineResource({
    model: 'Article',
    api: false,
    managers: { published: (query) => query.filter({ status: 'published' }) },
    schemas: {
        create: (schema) =>
            schema.extend({ title: z.string().min(3), status: z.enum(['draft', 'published', 'archived']) }),
        update: (schema) =>
            schema.omit({ ownerId: true }).extend({
                title: z.string().min(3).optional(),
                status: z.enum(['draft', 'published', 'archived']).optional(),
            }),
    },
});
export function articlesApp(events) {
    return defineApp({
        name: 'articles',
        dependsOn: ['projects'],
        resources: [Article],
        prisma: ['src/apps/articles/prisma'],
        policies: [
            {
                resource: Article.identity,
                authorize: ({ subject }) =>
                    subject.role === 'staff' || subject.role === 'admin' ? allow() : deny('NOT_STAFF'),
                actions: {
                    read: { scope: ({ subject }) => eq('ownerId', subject.id) },
                    create: {
                        // Discovery omits input; inserts still require validated, owner-matching data.
                        authorize: ({ subject, input }) =>
                            input === undefined || input.ownerId === subject.id ? allow() : deny('NOT_OWNER'),
                    },
                    update: { scope: ({ subject }) => eq('ownerId', subject.id) },
                    delete: { scope: ({ subject }) => eq('ownerId', subject.id) },
                    archive: { operations: ['update'], scope: ({ subject }) => eq('ownerId', subject.id) },
                },
            },
        ],
        configure: () => {
            events.push('configure:articles');
        },
        ready: () => {
            events.push('ready:articles');
        },
        shutdown: () => {
            events.push('shutdown:articles');
        },
    });
}
