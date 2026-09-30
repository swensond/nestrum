import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineProject } from 'vitest/config';

export default defineProject({
    plugins: [svelte({ configFile: false })],
    test: {
        name: '@nestrum/admin-ui',
        environment: 'node',
        include: ['tests/**/*.test.ts'],
    },
});
