import { createServer } from 'node:http';

export async function createFetchHost(fetch, port = 0) {
    const server = createServer(async (incoming, outgoing) => {
        try {
            const headers = new Headers();
            for (const [name, value] of Object.entries(incoming.headers)) {
                for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
                    headers.append(name, item);
                }
            }
            const controller = new AbortController();
            incoming.on('aborted', () => controller.abort());
            const request = new Request(`http://${headers.get('host')}${incoming.url}`, {
                method: incoming.method,
                headers,
                signal: controller.signal,
                ...(['GET', 'HEAD'].includes(incoming.method) ? {} : { body: incoming, duplex: 'half' }),
            });
            const response = await fetch(request);
            outgoing.statusCode = response.status;
            for (const [name, value] of response.headers) {
                if (name !== 'set-cookie') {
                    outgoing.setHeader(name, value);
                }
            }
            const cookies = response.headers.getSetCookie();
            if (cookies.length) {
                outgoing.setHeader('set-cookie', cookies);
            }
            outgoing.end(Buffer.from(await response.arrayBuffer()));
        } catch (error) {
            console.error('Example HTTP host failed.', error);
            outgoing.statusCode = 500;
            outgoing.end('Internal server error.');
        }
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
    });
    const address = server.address();
    const baseURL = `http://127.0.0.1:${address.port}`;

    return {
        baseURL,
        stop: () => {
            server.close();
            server.closeIdleConnections();
        },
    };
}
