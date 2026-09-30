import { describe, expect, it } from 'vitest';
import { ApiError, createApiClient, createAuthClient, readPublicConfig, resolveApiPath } from '../src/client/index.js';

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('api client', () => {
    it('resolves same-origin /api paths and rejects everything else', () => {
        expect(resolveApiPath('/projects')).toBe('/api/projects');
        expect(resolveApiPath('projects')).toBe('/api/projects');
        expect(resolveApiPath('/api/projects')).toBe('/api/projects');
        for (const bad of ['//evil.test/x', 'https://evil.test', '/../__admin/x', '/__admin/resources', '/api/../x']) {
            expect(() => resolveApiPath(bad)).toThrow(ApiError);
        }
        expect(() => resolveApiPath('/x', '/admin')).toThrow(ApiError);
    });

    it('sends credentials, query, JSON bodies and returns parsed data', async () => {
        const seen: { url: string; init: RequestInit }[] = [];
        const client = createApiClient({
            fetch: async (url, init) => {
                seen.push({ url: String(url), init: init ?? {} });

                return json({ data: [1] });
            },
        });
        expect(await client.get('/projects', { query: { limit: 5, q: undefined } })).toEqual({ data: [1] });
        await client.post('/projects', { body: { name: 'a' } });
        expect(seen[0]?.url).toBe('/api/projects?limit=5');
        expect(seen[0]?.init.credentials).toBe('same-origin');
        expect(seen[1]?.init.body).toBe('{"name":"a"}');
    });

    it('maps Nestrum errors to ApiError and handles 204', async () => {
        const failing = createApiClient({
            fetch: async () => json({ error: { code: 'FORBIDDEN', message: 'No.' } }, 403),
        });
        await expect(failing.get('/x')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN', message: 'No.' });
        const html = createApiClient({ fetch: async () => new Response('<html>oops</html>', { status: 502 }) });
        await expect(html.get('/x')).rejects.toMatchObject({ status: 502, code: 'REQUEST_FAILED' });
        const empty = createApiClient({ fetch: async () => new Response(null, { status: 204 }) });
        expect(await empty.delete('/x/1')).toBeUndefined();
    });
});

describe('auth client', () => {
    const session = { user: { id: 'u1', email: 'a@b.test' }, session: { id: 's1' } };

    it('reads the session and user, treating null as anonymous', async () => {
        const client = createAuthClient({ fetch: async () => json(session) });
        expect((await client.getSession())?.user.id).toBe('u1');
        expect((await client.getUser())?.email).toBe('a@b.test');
        const anonymous = createAuthClient({ fetch: async () => json(null) });
        expect(await anonymous.getSession()).toBeNull();
    });

    it('signs in and out while publishing state', async () => {
        const calls: string[] = [];
        let signedIn = false;
        const client = createAuthClient({
            fetch: async (url, init) => {
                calls.push(`${init?.method ?? 'GET'} ${String(url)}`);
                if (String(url).endsWith('/sign-in/email')) {
                    signedIn = true;

                    return json({ ok: true });
                }
                if (String(url).endsWith('/sign-out')) {
                    signedIn = false;

                    return json({ success: true });
                }

                return json(signedIn ? session : null);
            },
        });
        const states: string[] = [];
        client.state.subscribe((state) => states.push(state.status));
        await client.signIn({ email: 'a@b.test', password: 'pw' });
        await client.signOut();
        expect(states).toEqual(['loading', 'authenticated', 'anonymous']);
        expect(calls).toContain('POST /api/auth/sign-in/email');
        expect(calls.every((call) => !call.includes('__admin'))).toBe(true);
    });

    it('surfaces failed sign-in as anonymous state with the Better Auth error', async () => {
        const client = createAuthClient({
            fetch: async () => json({ code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid.' }, 401),
        });
        await expect(client.signIn({ email: 'a@b.test', password: 'x' })).rejects.toMatchObject({
            status: 401,
            code: 'INVALID_EMAIL_OR_PASSWORD',
        });
        expect((await client.refresh()).status).toBe('anonymous');
    });

    it('exposes no admin surface', () => {
        expect(Object.keys(createAuthClient())).toEqual([
            'getSession',
            'getUser',
            'signIn',
            'signOut',
            'refresh',
            'state',
        ]);
    });
});

describe('public config', () => {
    it('reads string values only and tolerates absence or garbage', () => {
        const doc = (text: string | null) => ({
            getElementById: () => (text === null ? null : ({ textContent: text } as HTMLElement)),
        });
        expect(readPublicConfig(doc('{"a":"1","b":2}'))).toEqual({ a: '1' });
        expect(readPublicConfig(doc('not json'))).toEqual({});
        expect(readPublicConfig(doc(null))).toEqual({});
        expect(readPublicConfig(undefined)).toEqual({});
    });
});
