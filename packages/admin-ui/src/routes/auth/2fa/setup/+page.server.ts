import { redirect } from '@sveltejs/kit';
import { safeReturnTo, withNext } from '$lib/return-to.js';
import { confirmEnrollment, startEnrollment } from '$lib/two-factor.server.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * Unlike the challenge pages this one never redirects away on success: the confirmation response is the only
 * place recovery codes are ever shown, and the reload after it already reports a verified session.
 */
export const load = (async ({ parent, url }) => {
    const { admin } = await parent();
    const next = safeReturnTo(url.searchParams.get('next'));
    if (admin.status === 'two-factor' && admin.reason === 'challenge-required') {
        redirect(303, withNext('/admin/auth/2fa', next));
    }

    return { next };
}) satisfies PageServerLoad;

export const actions = { start: startEnrollment, confirm: confirmEnrollment } satisfies Actions;
