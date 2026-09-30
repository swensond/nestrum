import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getRequestListener } from '@hono/node-server';
import type { RuntimeAdapter, ServableApplication, ServeOptions, ServerHandle } from '@nestrum/runtime';

function validate(options: ServeOptions): void {
    if (typeof options.host !== 'string' || options.host === '') {
        throw new TypeError('Node runtime host must be a non-empty string.');
    }
    if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
        throw new RangeError('Node runtime port must be an integer between 0 and 65535.');
    }
}

/**
 * Node HTTP adapter. It serves an already-ready application's Fetch handler and never starts, drains, or shuts down
 * the application itself.
 *
 * - `serve` resolves once the socket is listening, and rejects (with no listener left behind) on bind failures.
 * - `stopAccepting` synchronously stops the listener; in-flight requests continue and idle keep-alive connections
 *   are closed.
 * - `close` stops accepting, then resolves once every connection has ended, so in-flight requests finish first.
 *   Deadlines and forced termination are PM1.6 concerns.
 */
export const nodeRuntime: RuntimeAdapter = {
    async serve(application: ServableApplication, options: ServeOptions): Promise<ServerHandle> {
        validate(options);
        const server = createServer(
            getRequestListener((request) => application.fetch(request), { overrideGlobalObjects: false }),
        );
        await new Promise<void>((resolve, reject) => {
            const failed = (error: Error) => {
                server.close();
                reject(error);
            };
            server.once('error', failed);
            server.listen(options.port, options.host, () => {
                server.off('error', failed);
                resolve();
            });
        });
        const address = server.address() as AddressInfo;
        const closed = new Promise<void>((resolve) => server.once('close', resolve));
        let stopped = false;
        const stopAccepting = async (): Promise<void> => {
            if (!stopped) {
                stopped = true;
                server.close();
                server.closeIdleConnections();
            }
        };

        return {
            host: options.host,
            port: address.port,
            stopAccepting,
            close: async () => {
                await stopAccepting();
                await closed;
            },
        };
    },
};
