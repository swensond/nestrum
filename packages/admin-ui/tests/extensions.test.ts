import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import { createAdminComponentRegistry } from '../src/lib/component-registry.js';
import { AdminResourceClient } from '../src/lib/crud.js';
import FieldRenderer from '../src/lib/FieldRenderer.svelte';
import { fieldWidget } from '../src/lib/fields.js';
import ResourceActions from '../src/lib/ResourceActions.svelte';
import { runResourceAction } from '../src/lib/resource.server.js';
import CustomWidget from './CustomWidget.svelte';
import { resource } from './fixtures.js';

const field = {
    ...resource().fields[0]!,
    name: 'notes',
    primaryKey: false,
    readOnly: false,
    creatable: true,
    updatable: true,
    widget: 'json-editor',
};
const metadata = { ...resource(), actions: [{ name: 'archive', label: 'Archive project' }] };
const request = (input: Record<string, string>) =>
    new Request('http://localhost/admin/projects/1?/action', { method: 'POST', body: new URLSearchParams(input) });

describe('Admin components and actions', () => {
    it('registers and renders custom widgets without resource-specific pages', async () => {
        const components = createAdminComponentRegistry().register('json-editor', CustomWidget).seal();
        const result = await render(FieldRenderer, {
            props: { field, mode: 'create', value: '[{"name":"One"}]', components },
        });
        expect(result.body).toContain('data-custom-widget="json-editor"');
        expect(result.body).toContain('name="notes"');
        expect(result.body).toContain('One');
        expect(() => components.register('late', CustomWidget)).toThrow();
    });
    it('rejects duplicate and unsafe names and keeps registries isolated', () => {
        const components = createAdminComponentRegistry().register('custom', CustomWidget);
        expect(() => components.register('custom', CustomWidget)).toThrow();
        expect(() => components.register('../remote', CustomWidget)).toThrow();
        expect(createAdminComponentRegistry().get('custom')).toBeUndefined();
    });
    it('keeps readonly fields outside custom renderers and supports built-in overrides', async () => {
        const components = createAdminComponentRegistry().register('json-editor', CustomWidget);
        const readonly = await render(FieldRenderer, {
            props: { field: { ...field, readOnly: true }, mode: 'create', value: 'Read only', components },
        });
        expect(readonly.body).not.toContain('data-custom-widget');
        expect(readonly.body).toContain('Read only');
        expect(fieldWidget({ ...field, widget: 'textarea' }, 'create')).toBe('textarea');
        expect(fieldWidget({ ...field, widget: 'text' }, 'create')).toBe('text');
    });
    it('renders only known metadata actions with ordinary POST forms and escaped labels', async () => {
        const result = await render(ResourceActions, {
            props: { resource: { ...metadata, actions: [{ name: 'archive', label: '<script>bad()</script>' }] } },
        });
        expect(result.body).toContain('?/action');
        expect(result.body).toContain('value="archive"');
        expect(result.body).not.toContain('<script>bad()</script>');
        expect((await render(ResourceActions, { props: { resource: resource() } })).body).not.toContain('<form');
    });
    it('rechecks metadata before forwarding a named action and refreshes after success', async () => {
        const fetch = vi
            .fn()
            .mockResolvedValueOnce(Response.json([metadata]))
            .mockResolvedValueOnce(new Response(null, { status: 204 }));
        await expect(
            runResourceAction({
                fetch,
                request: request({ action: 'archive', input: '{"reason":"ready"}' }),
                params: { resource: 'projects', id: '1' },
            }),
        ).rejects.toMatchObject({ status: 303, location: '/admin/projects/1?saved=action' });
        expect(fetch).toHaveBeenLastCalledWith(
            '/__admin/projects/1/actions/archive',
            expect.objectContaining({ method: 'POST', body: '{"reason":"ready"}', credentials: 'same-origin' }),
        );
    });
    it.each([
        { action: 'missing', input: '{}' },
        { action: 'archive', input: 'invalid' },
        { action: 'archive', input: '[]' },
    ])('rejects unknown actions or invalid JSON without dispatch: %j', async (input) => {
        const fetch = vi.fn(async () => Response.json([metadata]));
        expect(
            (await runResourceAction({ fetch, request: request(input), params: { resource: 'projects', id: '1' } }))
                ?.status,
        ).toBe(input.action === 'missing' ? 403 : 400);
        expect(fetch).toHaveBeenCalledTimes(1);
    });
    it('preserves generic action input and safe feedback on denial', async () => {
        const fetch = vi
            .fn()
            .mockResolvedValueOnce(Response.json([metadata]))
            .mockResolvedValueOnce(new Response('Secret', { status: 403 }));
        const result = await runResourceAction({
            fetch,
            request: request({ action: 'archive', input: '{}' }),
            params: { resource: 'projects', id: '1' },
        });
        expect(result?.status).toBe(403);
        expect(result?.data.values).toEqual({ action: 'archive', input: '{}' });
        expect(result?.data.message).not.toContain('Secret');
    });
    it('encodes arbitrary safe action names and record IDs', async () => {
        const fetch = vi.fn(async () => new Response(null, { status: 204 }));
        await new AdminResourceClient(fetch).action(metadata, 'a/b', 'mark.ready', {});
        expect(fetch).toHaveBeenCalledWith(
            '/__admin/projects/a%2Fb/actions/mark.ready',
            expect.objectContaining({ method: 'POST' }),
        );
    });
});
