import { readFile } from 'node:fs/promises';
import type { AdminUi } from '@nestrum/hono';
import type { Server, SSRManifest } from '@sveltejs/kit';

type ServerModule = { Server: new (manifest: SSRManifest) => Pick<Server, 'init' | 'respond'> };
type ManifestModule = { manifest: SSRManifest; assets: string[] };
const MIME_TYPES: Readonly<Record<string, string>> = {
    js: 'text/javascript; charset=utf-8',
    css: 'text/css; charset=utf-8',
    json: 'application/json',
    svg: 'image/svg+xml',
    png: 'image/png',
    ico: 'image/x-icon',
    woff2: 'font/woff2',
    txt: 'text/plain; charset=utf-8',
};

/** Load the prebuilt SvelteKit server once; request cookies and API dispatch stay request-scoped. */
export async function createAdminShell(): Promise<AdminUi> {
    const serverUrl = new URL('../server/index.js', import.meta.url).href;
    const manifestUrl = new URL('../manifest.js', import.meta.url).href;
    const { Server: ServerConstructor } = (await import(serverUrl)) as ServerModule;
    const { manifest, assets } = (await import(manifestUrl)) as ManifestModule;
    const server = new ServerConstructor(manifest);
    await server.init({ env: {} });
    const files = new Map(assets.map((file) => [`/admin/${file}`, file]));

    return Object.freeze({
        basePath: '/admin' as const,
        async handle(request: Request, context: Parameters<AdminUi['handle']>[1]) {
            const url = new URL(request.url);
            const file = files.get(url.pathname);
            if (file && ['GET', 'HEAD'].includes(request.method)) {
                const content = await readFile(new URL(`../assets/${file}`, import.meta.url));
                return new Response(request.method === 'HEAD' ? null : content, {
                    headers: {
                        'content-type': MIME_TYPES[file.split('.').at(-1) ?? ''] ?? 'application/octet-stream',
                        'cache-control': file.startsWith('_app/immutable/')
                            ? 'public, max-age=31536000, immutable'
                            : 'no-cache',
                        'x-content-type-options': 'nosniff',
                    },
                });
            }

            return server.respond(request, {
                platform: { adminFetch: context.fetch },
                getClientAddress: () => {
                    throw new Error('Client address is unavailable in the Fetch admin shell.');
                },
            });
        },
    });
}
