import type { Handle, HandleFetch } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
    const response = await resolve(event);
    response.headers.set('cache-control', 'private, no-store');
    response.headers.set('x-content-type-options', 'nosniff');
    response.headers.set('referrer-policy', 'same-origin');

    return response;
};

export const handleFetch: HandleFetch = async ({ event, request, fetch }) => {
    const url = new URL(request.url);
    if (url.origin === event.url.origin && url.pathname.startsWith('/__admin/')) {
        const headers = new Headers(request.headers);
        for (const name of ['cookie', 'origin', 'referer', 'sec-fetch-site']) {
            const value = event.request.headers.get(name);
            if (value !== null) {
                headers.set(name, value);
            }
        }
        const forwarded = new Request(request, { headers });

        return event.platform?.adminFetch ? event.platform.adminFetch(forwarded) : fetch(forwarded);
    }

    return fetch(request);
};
