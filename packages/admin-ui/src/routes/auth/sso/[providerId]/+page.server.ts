import {
    deleteProvider,
    loadSsoDetail,
    requestVerification,
    testProvider,
    toggleProvider,
    updateProvider,
    verifyDomain,
} from '$lib/sso.server.js';
import type { Actions, PageServerLoad } from './$types';

export const load = (async ({ parent, fetch, params, setHeaders }) => {
    const { admin } = await parent();
    setHeaders({ 'cache-control': 'no-store' });
    if (admin.status !== 'ready') {
        return { provider: null, capabilities: null, message: '' };
    }

    return loadSsoDetail(fetch, params.providerId);
}) satisfies PageServerLoad;

export const actions = {
    update: (event) => updateProvider(event),
    enable: (event) => toggleProvider(event, true),
    disable: (event) => toggleProvider(event, false),
    test: (event) => testProvider(event),
    delete: (event) => deleteProvider(event),
    requestVerification: (event) => requestVerification(event),
    verify: (event) => verifyDomain(event),
} satisfies Actions;
