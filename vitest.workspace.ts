import { defineProject } from 'vitest/config';

export default [
    defineProject({
        test: {
            name: '@nestrum/core',
            environment: 'node',
            include: ['packages/core/tests/**/*.test.ts']
        }
    }),
    defineProject({
        test: {
            name: '@nestrum/prisma',
            environment: 'node',
            include: ['packages/prisma/tests/**/*.test.ts']
        }
    }),
    defineProject({
        test: {
            name: '@nestrum/zod',
            environment: 'node',
            include: ['packages/zod/tests/**/*.test.ts']
        }
    })
];
