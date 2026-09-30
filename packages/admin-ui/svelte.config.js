import { resolve } from 'node:path';
import adapter from './tooling/fetch-adapter.js';

export default {
    kit: {
        adapter: adapter(),
        alias: {
            '$admin-components': process.env.NESTRUM_ADMIN_COMPONENTS
                ? resolve(process.env.NESTRUM_ADMIN_COMPONENTS)
                : 'src/admin-components.ts',
        },
        paths: { base: '/admin' },
    },
};
