import { redirect } from '@sveltejs/kit';
import { safeReturnTo, withNext } from '$lib/return-to.js';
import type { PageServerLoad } from './$types';

/**
 * Unlike the challenge pages this one never redirects away for a verified session: the enable response is the only
 * place backup codes are ever shown, and activation replaces the session, so the page must keep its own state.
 */
export const load = (async ({ parent, url }) => {
    const { admin } = await parent();
    const next = safeReturnTo(url.searchParams.get('next'));
    if (admin.status === 'two-factor' && admin.reason === 'challenge-required') {
        redirect(303, withNext('/admin/auth/2fa', next));
    }

    return { next };
}) satisfies PageServerLoad;
