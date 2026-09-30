import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineProject } from 'vitest/config';

export default defineProject({
    plugins: [svelte({ configFile: false })],
    resolve: { alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) } },
    test: {
        name: '@nestrum/admin-ui',
        environment: 'node',
        include: ['tests/**/*.test.ts'],
    },
});
