import { loadSsoList, testProvider, toggleProvider } from '$lib/sso.server.js';
import type { Actions, PageServerLoad } from './$types';

export const load = (async ({ parent, fetch, setHeaders }) => {
    const { admin } = await parent();
    setHeaders({ 'cache-control': 'no-store' });
    if (admin.status !== 'ready') {
        return { providers: null, capabilities: null, message: '' };
    }

    return loadSsoList(fetch);
}) satisfies PageServerLoad;

export const actions = {
    enable: (event) => toggleProvider(event, true),
    disable: (event) => toggleProvider(event, false),
    test: (event) => testProvider(event),
} satisfies Actions;
