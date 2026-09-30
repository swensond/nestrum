import { describe, expect, it } from 'vitest';
import type { FeatureState } from '../src/client/index.js';
import { createFeatureClient, FEATURES_PATH } from '../src/client/index.js';
import { isReservedPath } from '../src/routes.js';

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('feature client', () => {
    it('uses the reserved same-origin endpoint, credentialed and uncached', async () => {
        const seen: { url: string; init: RequestInit }[] = [];
        const client = createFeatureClient({
            fetch: async (url, init) => {
                seen.push({ url: String(url), init: init ?? {} });

                return json({ features: { newDashboard: true } });
            },
        });
        await client.load();
        expect(seen[0]?.url).toBe('/__nestrum/features');
        expect(isReservedPath(FEATURES_PATH)).toBe(true);
        expect(seen[0]?.init).toMatchObject({ credentials: 'same-origin', cache: 'no-store' });
    });

    it('reads flags synchronously from the snapshot and treats everything else as off', async () => {
        const client = createFeatureClient({
            fetch: async () =>
                json({ features: { newDashboard: true, beta: false, sneaky: 'true', constructor: true } }),
        });
        expect(client.enabled('newDashboard')).toBe(false);
        expect(await client.load()).toEqual({ newDashboard: true, beta: false, constructor: true });
        expect(client.enabled('newDashboard')).toBe(true);
        expect(client.enabled('beta')).toBe(false);
        expect(client.enabled('sneaky')).toBe(false);
        expect(client.enabled('hidden')).toBe(false);
        expect(client.enabled('toString')).toBe(false);
    });

    it('publishes loading, ready and error states and fails closed', async () => {
        let fail = false;
        const client = createFeatureClient({
            fetch: async () =>
                fail ? json({ error: { code: 'X', message: 'no' } }, 500) : json({ features: { a: true } }),
        });
        const states: FeatureState['status'][] = [];
        const stop = client.state.subscribe((state) => states.push(state.status));
        await client.load();
        expect(client.enabled('a')).toBe(true);
        fail = true;
        await client.load();
        expect(client.enabled('a')).toBe(false);
        stop();
        await client.load();
        expect(states).toEqual(['loading', 'ready', 'error']);
    });

    it('fails closed on network errors and malformed bodies', async () => {
        const offline = createFeatureClient({
            fetch: async () => {
                throw new Error('down');
            },
        });
        expect(await offline.load()).toEqual({});
        const malformed = createFeatureClient({ fetch: async () => new Response('<html>', { status: 200 }) });
        expect(await malformed.load()).toEqual({});
        expect(malformed.enabled('a')).toBe(false);
    });
});
