import { changeRole, loadAccessData } from '$lib/access.server.js';
import type { Actions, PageServerLoad } from './$types';

export const load = (async ({ parent, fetch, url }) => {
    const { admin } = await parent();
    if (admin.status !== 'ready') {
        return { page: null, message: '', email: '', offset: 0, saved: '' };
    }

    return loadAccessData(fetch, url);
}) satisfies PageServerLoad;

export const actions = { role: (event) => changeRole(event) } satisfies Actions;
