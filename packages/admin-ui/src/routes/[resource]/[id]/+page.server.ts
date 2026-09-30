import { error } from '@sveltejs/kit';
import { recordId } from '$lib/crud.js';
import { loadResourceData, mutateResource, runResourceAction } from '$lib/resource.server.js';
import { selectWorkspace } from '$lib/routes.js';
import type { Actions, PageServerLoad } from './$types';

export const load = (async ({ parent, params, fetch, url }) => {
    const { admin } = await parent();
    const workspace = selectWorkspace(admin, params.resource, 'detail', recordId(params.id));
    if (admin.status === 'ready' && !workspace) {
        error(404, 'Resource not available.');
    }

    return { workspace, ...(await loadResourceData(fetch, workspace, url)) };
}) satisfies PageServerLoad;

export const actions = {
    action: (event) => runResourceAction(event),
    update: (event) => mutateResource(event, 'update'),
    delete: (event) => mutateResource(event, 'delete'),
} satisfies Actions;
