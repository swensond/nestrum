import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    createWebHost,
    findRouteCollisions,
    isReservedPath,
    resolveWebConfig,
    serializePublicConfig,
} from '../src/index.js';

let dir: string;
const get = (path: string, init: RequestInit = {}) => new Request(`http://x.test${path}`, init);

beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nestrum-web-'));
    await mkdir(join(dir, 'assets'));
    await writeFile(join(dir, 'index.html'), '<html><head></head><body>app</body></html>');
    await writeFile(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
    await writeFile(join(dir, 'favicon.svg'), '<svg/>');
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe('createWebHost', () => {
    const host = () => createWebHost({ directory: dir, publicEnv: { analyticsId: 'a-1</script>' } });

    it('serves the index with escaped public config at / and on deep SPA routes', async () => {
        for (const path of ['/', '/projects', '/projects/42/edit']) {
            const response = await host().handle(get(path));
            const html = await response?.text();
            expect(response?.status).toBe(200);
            expect(response?.headers.get('cache-control')).toBe('no-cache');
            expect(html).toContain('id="__nestrum_config__"');
            expect(html).toContain('a-1\\u003c/script\\u003e');
            expect(html).not.toContain('a-1</script>');
        }
    });

    it('serves hashed assets as immutable and public files with short caching', async () => {
        const asset = await host().handle(get('/assets/app-abc123.js'));
        expect(asset?.headers.get('cache-control')).toContain('immutable');
        expect(asset?.headers.get('content-type')).toContain('javascript');
        const icon = await host().handle(get('/favicon.svg'));
        expect(icon?.headers.get('content-type')).toBe('image/svg+xml');
        expect(icon?.headers.get('cache-control')).toBe('public, max-age=3600');
    });

    it('never swallows framework namespaces, non-GET requests, missing assets, or non-HTML requests', async () => {
        for (const path of ['/api/things', '/admin', '/admin/x', '/__admin/y', '/__nestrum/health']) {
            expect(await host().handle(get(path))).toBeUndefined();
        }
        expect(await host().handle(get('/projects', { method: 'POST' }))).toBeUndefined();
        expect(await host().handle(get('/assets/missing.js'))).toBeUndefined();
        expect(await host().handle(get('/data', { headers: { accept: 'application/json' } }))).toBeUndefined();
    });

    it('cannot escape the output directory', async () => {
        // Traversal collapses at the output root and resolves to the SPA shell, never to a file outside it.
        for (const path of ['/..%2f..%2fetc/passwd', '/%2e%2e/secret']) {
            const response = await host().handle(get(path));
            expect(response === undefined || (await response.text()).includes('<body>app</body>')).toBe(true);
        }
    });

    it('answers HEAD without a body', async () => {
        const response = await host().handle(get('/', { method: 'HEAD' }));
        expect(response?.status).toBe(200);
        expect(await response?.text()).toBe('');
    });
});

describe('routes and config', () => {
    it('reserves framework namespaces', () => {
        expect(['/api', '/api/x', '/admin', '/__admin/a', '/__nestrum/ready'].every(isReservedPath)).toBe(true);
        expect(['/', '/projects', '/apiary', '/administrator'].some(isReservedPath)).toBe(false);
    });

    it('reports collisions by file and namespace', async () => {
        const root = await mkdtemp(join(tmpdir(), 'nestrum-web-routes-'));
        await mkdir(join(root, 'src/routes/admin'), { recursive: true });
        await mkdir(join(root, 'src/routes/projects'), { recursive: true });
        await mkdir(join(root, 'public'));
        await writeFile(join(root, 'public/api.json'), '{}');
        expect(await findRouteCollisions(root)).toEqual([
            { file: 'src/routes/admin', namespace: 'admin' },
            { file: 'public/api.json', namespace: 'api' },
        ]);
        await rm(root, { recursive: true, force: true });
    });

    it('validates web config and filters to explicit public env', () => {
        expect(resolveWebConfig(undefined)).toBeUndefined();
        expect(resolveWebConfig({ enabled: false })).toBeUndefined();
        expect(resolveWebConfig({ enabled: true })).toEqual({ root: './src/web', publicEnv: {} });
        expect(resolveWebConfig({ enabled: true, publicEnv: { id: 'x' } })?.publicEnv).toEqual({ id: 'x' });
        expect(() => resolveWebConfig({ enabled: true, publicEnv: { id: undefined as never } })).toThrow(
            /string value/,
        );
        expect(() => resolveWebConfig({ enabled: true, root: ' ' })).toThrow(/root/);
        expect(serializePublicConfig({ a: '<&>\u2028' })).not.toMatch(/[<>&\u2028]/);
    });
});
