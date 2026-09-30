import { createKey, loadApiKeyData, revokeKey, rotateKey } from '$lib/api-keys.server.js';
import type { Actions, PageServerLoad } from './$types';

export const load = (async ({ parent, fetch, url, setHeaders }) => {
    const { admin } = await parent();
    setHeaders({ 'cache-control': 'no-store' });
    if (admin.status !== 'ready') {
        return { page: null, capabilities: null, message: '', offset: 0 };
    }

    return loadApiKeyData(fetch, url);
}) satisfies PageServerLoad;

export const actions = {
    create: (event) => createKey(event),
    revoke: (event) => revokeKey(event),
    rotate: (event) => rotateKey(event),
} satisfies Actions;
