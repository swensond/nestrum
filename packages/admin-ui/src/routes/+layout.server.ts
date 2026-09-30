import { redirect } from '@sveltejs/kit';
import { loadAdminState } from '$lib/metadata.js';
import { isAuthPath, twoFactorHref } from '$lib/return-to.js';
import type { LayoutServerLoad } from './$types';

export const load = (async ({ fetch, depends, url }) => {
    depends('nestrum:admin');
    const admin = await loadAdminState(fetch);
    // Browser navigation lacking required assurance goes to the framework-owned pages (API calls get JSON errors).
    if (admin.status === 'two-factor' && !isAuthPath(url.pathname)) {
        redirect(303, twoFactorHref(admin.reason, url));
    }

    return { admin, path: url.pathname };
}) satisfies LayoutServerLoad;
