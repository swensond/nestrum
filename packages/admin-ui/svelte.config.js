import adapter from './tooling/fetch-adapter.js';

export default {
    kit: {
        adapter: adapter(),
        paths: { base: '/admin' },
    },
};
