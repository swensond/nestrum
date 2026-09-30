import { createProvider, loadSsoNew } from '$lib/sso.server.js';
import type { Actions, PageServerLoad } from './$types';

export const load = (async ({ parent, fetch, url, setHeaders }) => {
    const { admin } = await parent();
    setHeaders({ 'cache-control': 'no-store' });
    if (admin.status !== 'ready') {
        return { capabilities: null, type: 'oidc' as const, message: '' };
    }

    return loadSsoNew(fetch, url);
}) satisfies PageServerLoad;

export const actions = { create: (event) => createProvider(event) } satisfies Actions;
