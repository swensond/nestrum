import { defineConfig } from 'vitest/config';
import projects from './vitest.workspace.js';

export default defineConfig({
    ssr: {
        resolve: {
            conditions: ['nestrum-source', 'node', 'import', 'default']
        }
    },
    test: {
        projects
    }
});
