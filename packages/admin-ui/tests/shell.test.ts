import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import { AdminMetadataClient, AdminMetadataError, loadAdminState } from '../src/lib/metadata.js';
import { resourceHref, selectWorkspace } from '../src/lib/routes.js';
import { resource } from './fixtures.js';
import ShellFixture from './ShellFixture.svelte';

describe('Metadata-driven administration', () => {
    it('validates metadata over a credentialed, uncached private API request', async () => {
        const fetch = vi.fn(async () => Response.json([resource()]));
        expect(await new AdminMetadataClient(fetch).resources()).toEqual([resource()]);
        expect(fetch).toHaveBeenCalledWith('/__admin/resources', {
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { accept: 'application/json' },
        });
    });

    it.each([
        {},
        [resource(), resource()],
        [{ ...resource(), slug: '../outside' }],
        [{ ...resource(), capabilities: null }],
    ])('rejects invalid or ambiguous API metadata', async (data) => {
        await expect(new AdminMetadataClient(async () => Response.json(data)).resources()).rejects.toBeInstanceOf(
            AdminMetadataError,
        );
    });

    it('does not retain one session’s resource metadata for another request', async () => {
        const fetch = vi
            .fn()
            .mockResolvedValueOnce(Response.json([resource()]))
            .mockResolvedValueOnce(Response.json([], { status: 401 }));
        const client = new AdminMetadataClient(fetch);
        expect(await client.resources()).toHaveLength(1);
        await expect(client.resources()).rejects.toMatchObject({ status: 401 });
    });

    it.each([
        { status: 401, expected: 'sign-in' },
        { status: 403, expected: 'denied' },
        { status: 500, expected: 'error' },
    ])('turns status $status into the $expected session boundary', async ({ status, expected }) => {
        const state = await loadAdminState(async () =>
            Response.json({ message: 'Private backend details' }, { status }),
        );
        expect(state.status).toBe(expected);
        expect(JSON.stringify(state)).not.toContain('Private backend details');
    });

    it('handles invalid JSON, invalid metadata and network errors without revealing details', async () => {
        for (const fetch of [
            async () => new Response('{'),
            async () => Response.json({ bad: true }),
            async () => {
                throw new Error('Private hostname');
            },
        ]) {
            expect(await loadAdminState(fetch)).toEqual({
                status: 'error',
                message: 'Administration is temporarily unavailable. Please try again.',
            });
        }
    });

    it('adds navigation for a second resource without any resource-specific Svelte page', async () => {
        const one = await render(ShellFixture, { props: { state: { status: 'ready', resources: [resource()] } } });
        expect(one.body).toContain('href="/admin/projects"');
        expect(one.body).not.toContain('href="/admin/articles"');
        const two = await render(ShellFixture, {
            props: {
                state: { status: 'ready', resources: [resource(), resource('Article', 'articles')] },
                activePath: '/admin/articles/new',
            },
        });
        expect(two.body).toContain('href="/admin/projects"');
        expect(two.body).toMatch(/href="\/admin\/articles"[^>]*aria-current="page"/);
        expect(two.body).toContain('Protected workspace content');
    });

    it.each(['sign-in', 'denied', 'error'] as const)(
        'hides resource navigation and protected content at the %s boundary',
        async (status) => {
            const output = await render(ShellFixture, { props: { state: { status, message: 'Boundary message' } } });
            expect(output.body).not.toContain('aria-label="Admin resources"');
            expect(output.body).not.toContain('Protected workspace content');
            expect(output.body).toContain('Boundary message');
            if (status === 'sign-in') {
                expect(output.body).toContain('autocomplete="current-password"');
            }
        },
    );

    it('hides previous session content while navigation loads', async () => {
        const output = await render(ShellFixture, {
            props: { state: { status: 'ready', resources: [resource()] }, loading: true },
        });
        expect(output.body).toContain('Loading administration');
        expect(output.body).not.toContain('Protected workspace content');
        expect(output.body).not.toContain('href="/admin/projects"');
    });

    it('escapes metadata labels and derives named-database links safely', async () => {
        const project = { ...resource(), slug: 'documents--projects', label: '<script>alert(1)</script>' };
        const output = await render(ShellFixture, { props: { state: { status: 'ready', resources: [project] } } });
        expect(output.body).not.toContain('<script>alert(1)</script>');
        expect(output.body).toContain('&lt;script>');
        expect(resourceHref(project)).toBe('/admin/documents--projects');
    });

    it('gives all generic routes the selected metadata while gating action-specific views', async () => {
        const project = resource();
        const state = { status: 'ready' as const, resources: [project] };
        for (const view of ['list', 'new', 'detail'] as const) {
            const workspace = selectWorkspace(state, 'projects', view, view === 'detail' ? 'record-one' : undefined);
            expect(workspace?.resource.identity).toBe('default.Project');
        }
        expect(selectWorkspace(state, 'missing', 'list')).toBeNull();
        expect(selectWorkspace({ status: 'sign-in', message: 'Sign in' }, 'projects', 'new')).toBeNull();
        expect(
            selectWorkspace(
                {
                    status: 'ready',
                    resources: [{ ...project, capabilities: { ...project.capabilities, create: false } }],
                },
                'projects',
                'new',
            ),
        ).toBeNull();
    });
});
