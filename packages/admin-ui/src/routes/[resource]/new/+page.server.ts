import { error } from '@sveltejs/kit';
import { loadResourceData, mutateResource } from '$lib/resource.server.js';
import { selectWorkspace } from '$lib/routes.js';
import type { Actions, PageServerLoad } from './$types';

export const load = (async ({ parent, params, fetch, url }) => {
    const { admin } = await parent();
    const workspace = selectWorkspace(admin, params.resource, 'new');
    if (admin.status === 'ready' && !workspace) {
        error(404, 'Resource not available.');
    }

    return { workspace, ...(await loadResourceData(fetch, workspace, url)) };
}) satisfies PageServerLoad;

export const actions = { create: (event) => mutateResource(event, 'create') } satisfies Actions;
