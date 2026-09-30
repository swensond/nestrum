import { redirect } from '@sveltejs/kit';
import { safeReturnTo, withNext } from '$lib/return-to.js';
import { submitChallenge } from '$lib/two-factor.server.js';
import type { Actions, PageServerLoad } from './$types';

export const load = (async ({ parent, url }) => {
    const { admin } = await parent();
    const next = safeReturnTo(url.searchParams.get('next'));
    if (admin.status === 'ready') {
        redirect(303, next);
    }
    if (admin.status === 'two-factor' && admin.reason === 'setup-required') {
        redirect(303, withNext('/admin/auth/2fa/setup', next));
    }

    return { next };
}) satisfies PageServerLoad;

export const actions = { default: (event) => submitChallenge(event, 'recovery') } satisfies Actions;
