import { loadAdminState } from '$lib/metadata.js';
import type { LayoutServerLoad } from './$types';

export const load = (async ({ fetch, depends, url }) => {
    depends('nestrum:admin');

    return { admin: await loadAdminState(fetch), path: url.pathname };
}) satisfies LayoutServerLoad;
