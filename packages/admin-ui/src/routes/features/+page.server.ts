import { explainFlag, loadFeatureData, removeRule, saveRule } from '$lib/features.server.js';
import type { Actions, PageServerLoad } from './$types';

export const load = (async ({ parent, fetch, setHeaders }) => {
    const { admin } = await parent();
    setHeaders({ 'cache-control': 'no-store' });
    if (admin.status !== 'ready') {
        return { flags: null, capabilities: null, message: '' };
    }

    return loadFeatureData(fetch);
}) satisfies PageServerLoad;

export const actions = {
    save: (event) => saveRule(event),
    remove: (event) => removeRule(event),
    explain: (event) => explainFlag(event),
} satisfies Actions;
