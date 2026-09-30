import { error } from '@sveltejs/kit';
import { loadResourceData } from '$lib/resource.server.js';
import { selectWorkspace } from '$lib/routes.js';
import type { PageServerLoad } from './$types';

export const load = (async ({ parent, params, fetch, url }) => {
    const { admin } = await parent();
    const workspace = selectWorkspace(admin, params.resource, 'list');
    if (admin.status === 'ready' && !workspace) {
        error(404, 'Resource not available.');
    }

    return { workspace, ...(await loadResourceData(fetch, workspace, url)) };
}) satisfies PageServerLoad;
