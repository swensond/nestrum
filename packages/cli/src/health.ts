export const HEALTH_PATH = '/__nestrum/health';
export const READY_PATH = '/__nestrum/ready';

type Fetchable = { readonly fetch: (request: Request) => Response | Promise<Response> };

const json = (status: number, body: Record<string, string>, request: Request): Response =>
    new Response(request.method === 'HEAD' ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });

/**
 * Add the framework health and readiness probes in front of an application. Responses disclose nothing beyond a
 * status word. Health means the process is serving; readiness means bootstrap completed and shutdown has not begun.
 */
export function withHealth(application: Fetchable, isReady: () => boolean): Fetchable {
    return {
        fetch: (request) => {
            const { pathname } = new URL(request.url);
            if (pathname !== HEALTH_PATH && pathname !== READY_PATH) {
                return application.fetch(request);
            }
            if (request.method !== 'GET' && request.method !== 'HEAD') {
                return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
            }
            if (pathname === HEALTH_PATH) {
                return json(200, { status: 'ok' }, request);
            }

            return isReady() ? json(200, { status: 'ready' }, request) : json(503, { status: 'unavailable' }, request);
        },
    };
}
