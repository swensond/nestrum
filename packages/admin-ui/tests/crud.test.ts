import type { AdminFieldMetadata } from '@nestrum/admin';
import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import { AdminCrudError, AdminResourceClient, recordHref, recordId } from '../src/lib/crud.js';
import FieldRenderer from '../src/lib/FieldRenderer.svelte';
import { fieldWidget, initialValueMode, inputValue, parseResourceForm } from '../src/lib/fields.js';
import ResourceDelete from '../src/lib/ResourceDelete.svelte';
import ResourceForm from '../src/lib/ResourceForm.svelte';
import ResourceTable from '../src/lib/ResourceTable.svelte';
import { loadResourceData, mutateResource } from '../src/lib/resource.server.js';
import { resource } from './fixtures.js';

function field(name = 'name', options: Partial<AdminFieldMetadata> = {}): AdminFieldMetadata {
    return {
        ...resource().fields[0]!,
        name,
        label: name,
        primaryKey: false,
        hasCreateDefault: false,
        creatable: true,
        updatable: true,
        required: true,
        readOnly: false,
        ...options,
    };
}
function fields(...values: AdminFieldMetadata[]) {
    return { ...resource(), listDisplay: ['name'], fields: [resource().fields[0]!, ...values] };
}
function form(values: Record<string, string>) {
    const data = new FormData();
    for (const [name, value] of Object.entries(values)) {
        data.set(name, value);
    }
    return data;
}

describe('Generic field rendering and form transport', () => {
    it.each([
        [field(), 'text', 'type="text"'],
        [field('description'), 'textarea', '<textarea'],
        [field('count', { kind: 'integer' }), 'number', 'type="number"'],
        [field('enabled', { kind: 'boolean' }), 'boolean', '<select'],
        [field('status', { enumValues: ['draft', 'live'] }), 'enum', 'value="live"'],
        [field('day', { kind: 'date-string' }), 'date', 'type="date"'],
        [field('createdAt', { kind: 'date' }), 'datetime-local', 'type="datetime-local"'],
        [field('at', { kind: 'temporal-datetime' }), 'datetime-local', 'type="datetime-local"'],
        [field('time', { kind: 'temporal-time' }), 'time', 'type="time"'],
        [field('tags', { array: true }), 'textarea', 'JSON array'],
        [field('locked', { readOnly: true }), 'readonly', '<output'],
    ] as const)('renders $1 widgets from metadata', async (metadata, widget, expected) => {
        expect(fieldWidget(metadata, 'create')).toBe(widget);
        const output = await render(FieldRenderer, {
            props: { field: metadata, mode: 'create', value: '<script>bad()</script>' },
        });
        expect(output.body).toContain(expected);
        expect(output.body).not.toContain('<script>bad()</script>');
        if (widget === 'readonly') {
            expect(output.body).not.toContain('name="locked"');
        }
    });

    it('keeps false/zero, blank strings, bigint precision and UTC/Temporal input representations', () => {
        const metadata = fields(
            field(),
            field('count', { kind: 'integer' }),
            field('enabled', { kind: 'boolean' }),
            field('budget', { kind: 'bigint' }),
            field('at', { kind: 'date' }),
            field('local', { kind: 'temporal-datetime' }),
        );
        const parsed = parseResourceForm(
            metadata,
            'create',
            form({
                name: '',
                count: '0',
                enabled: 'false',
                budget: '9223372036854775807',
                at: '2026-10-01T12:30',
                local: '2026-10-01T12:30',
            }),
        );
        expect(parsed.feedback.message).toBe('');
        expect(parsed.body).toEqual({
            name: '',
            count: 0,
            enabled: false,
            budget: '9223372036854775807',
            at: '2026-10-01T12:30:00.000Z',
            local: '2026-10-01T12:30:00',
        });
        expect(inputValue(field('at', { kind: 'date' }), '2026-10-01T14:30:00+02:00')).toBe('2026-10-01T12:30:00.000');
    });

    it('distinguishes omitted/default fields, explicit null, and empty strings without submitting readonly keys', () => {
        const metadata = fields(
            field(),
            field('note', { nullable: true }),
            field('defaulted', { required: false, hasCreateDefault: true }),
        );
        const parsed = parseResourceForm(
            metadata,
            'create',
            form({ name: '', 'mode:note': 'null', 'mode:defaulted': 'omit' }),
        );
        expect(parsed.body).toEqual({ name: '', note: null });
        expect(parsed.feedback.message).toBe('');
        expect(initialValueMode(metadata.fields[3]!, 'create', undefined)).toBe('omit');
        expect(initialValueMode(field(), 'update', 'Original')).toBe('omit');
        expect(
            parseResourceForm(
                metadata,
                'update',
                form({ 'mode:name': 'omit', 'mode:note': 'omit', 'mode:defaulted': 'omit' }),
            ).feedback.message,
        ).toContain('at least one');
    });

    it.each([
        ['count', 'NaN', { kind: 'number' }],
        ['count', '1.5', { kind: 'integer' }],
        ['enabled', 'maybe', { kind: 'boolean' }],
        ['budget', '1e9', { kind: 'bigint' }],
        ['tags', '{}', { array: true }],
        ['at', 'invalid', { kind: 'date' }],
    ] as const)('rejects malformed %s values before sending', (name, value, options) => {
        expect(
            parseResourceForm(fields(field(name, options)), 'create', form({ [name]: value })).feedback.fields[name],
        ).toHaveLength(1);
    });

    it('rejects unknown, readonly, duplicate and illegal null/omit inputs', () => {
        const metadata = fields(field());
        expect(parseResourceForm(metadata, 'create', form({ name: 'One', id: 'forged' })).feedback.message).toContain(
            'unexpected',
        );
        const duplicate = form({ name: 'One' });
        duplicate.append('name', 'Two');
        expect(parseResourceForm(metadata, 'create', duplicate).feedback.message).toContain('unexpected');
        expect(parseResourceForm(metadata, 'create', form({ 'mode:name': 'null' })).feedback.fields.name).toHaveLength(
            1,
        );
        expect(parseResourceForm(metadata, 'create', form({ 'mode:name': 'omit' })).feedback.fields.name).toHaveLength(
            1,
        );
    });

    it('renders retained values and accessible server validation errors without readonly form controls', async () => {
        const output = await render(ResourceForm, {
            props: {
                resource: fields(field()),
                mode: 'create',
                feedback: {
                    message: 'Check fields',
                    values: { name: 'Retained' },
                    modes: { name: 'value' },
                    fields: { name: ['Too short'] },
                },
            },
        });
        expect(output.body).toContain('value="Retained"');
        expect(output.body).toContain('Too short');
        expect(output.body).toContain('aria-invalid="true"');
        expect(output.body).not.toContain('name="id"');
    });

    it('uses only visible listDisplay fields and safe record links', async () => {
        const metadata = { ...fields(field()), listDisplay: ['name', 'secret'] };
        const output = await render(ResourceTable, {
            props: { resource: metadata, rows: [{ id: 'a/b', name: 'One', secret: 'DO_NOT_DISPLAY' }] },
        });
        expect(output.body).toContain('One');
        expect(output.body).not.toContain('DO_NOT_DISPLAY');
        expect(output.body).toContain('href="/admin/projects/a%2Fb"');
        for (const id of ['.', '..', '']) {
            expect(recordHref(metadata, { id })).toBeNull();
        }
        expect(recordHref(metadata, { id: 'new' })).toBe('/admin/projects/~new');
        expect(recordHref(metadata, { id: '~new' })).toBe('/admin/projects/~~new');
        expect(recordId('~~new')).toBe('~new');
        expect(recordHref(metadata, { id: 0 })).toBe('/admin/projects/0');
        expect((await render(ResourceDelete, { props: { label: 'Project', id: '1' } })).body).toContain(
            'Confirm permanent deletion',
        );
    });
});

describe('Private CRUD client and server actions', () => {
    it('uses the independent private API for all operations and encodes IDs', async () => {
        const fetch = vi
            .fn()
            .mockResolvedValueOnce(Response.json({ rows: [{ id: 1 }] }))
            .mockResolvedValueOnce(Response.json({ id: 1 }))
            .mockResolvedValueOnce(Response.json({ id: 2 }, { status: 201 }))
            .mockResolvedValueOnce(new Response(null, { status: 204 }))
            .mockResolvedValueOnce(new Response(null, { status: 204 }));
        const client = new AdminResourceClient(fetch);
        expect(await client.list(resource(), 50, '-id')).toEqual([{ id: 1 }]);
        await client.retrieve(resource(), 'a/b');
        await client.create(resource(), { name: 'One' });
        await client.update(resource(), 'a/b', { name: 'Two' });
        await client.delete(resource(), 'a/b');
        expect(fetch.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
            ['/__admin/projects?limit=50&orderBy=-id', 'GET'],
            ['/__admin/projects/a%2Fb', 'GET'],
            ['/__admin/projects', 'POST'],
            ['/__admin/projects/a%2Fb', 'PATCH'],
            ['/__admin/projects/a%2Fb', 'DELETE'],
        ]);
        expect(
            fetch.mock.calls.every(([, init]) => init.credentials === 'same-origin' && init.cache === 'no-store'),
        ).toBe(true);
    });

    it('preserves server field issues but redacts arbitrary backend failures', async () => {
        const metadata = fields(field());
        const client = new AdminResourceClient(async () =>
            Response.json(
                {
                    error: {
                        message: 'Secret connection',
                        issues: [
                            { path: ['name'], message: 'Must contain at least 3 characters' },
                            { path: ['secret'], message: 'Do not reveal' },
                        ],
                    },
                },
                { status: 400 },
            ),
        );
        await expect(client.create(metadata, {})).rejects.toMatchObject({
            fields: { name: ['Must contain at least 3 characters'] },
        });
        await expect(
            new AdminResourceClient(async () => new Response('Secret', { status: 500 })).list(metadata),
        ).rejects.toMatchObject({ message: 'Unable to complete the request. Please try again.' });
        await expect(
            new AdminResourceClient(async () => Response.json({ rows: [null] })).list(metadata),
        ).rejects.toBeInstanceOf(AdminCrudError);
    });

    it('rechecks session and operation metadata on every forged direct action', async () => {
        const fetch = vi.fn(async () => new Response(null, { status: 401 }));
        const result = await mutateResource(
            {
                fetch,
                request: new Request('http://localhost/admin/projects/new', {
                    method: 'POST',
                    body: form({ name: 'One' }),
                }),
                params: { resource: 'projects' },
            },
            'create',
        );
        expect(result?.status).toBe(401);
        expect(fetch).toHaveBeenCalledTimes(1);
        const denied = { ...fields(field()), capabilities: { ...resource().capabilities, create: false } };
        const blocked = vi.fn(async () => Response.json([denied]));
        expect(
            (
                await mutateResource(
                    {
                        fetch: blocked,
                        request: new Request('http://localhost', { method: 'POST', body: form({ name: 'One' }) }),
                        params: { resource: 'projects' },
                    },
                    'create',
                )
            )?.status,
        ).toBe(403);
        expect(blocked).toHaveBeenCalledTimes(1);
    });

    it('requires confirmed deletion, forwards empty-body writes and redirects after success', async () => {
        const fetch = vi.fn().mockResolvedValueOnce(Response.json([resource()]));
        expect(
            (
                await mutateResource(
                    {
                        fetch,
                        request: new Request('http://localhost', { method: 'POST', body: form({}) }),
                        params: { resource: 'projects', id: '1' },
                    },
                    'delete',
                )
            )?.status,
        ).toBe(400);
        expect(fetch).toHaveBeenCalledTimes(1);
        const confirmed = vi
            .fn()
            .mockResolvedValueOnce(Response.json([resource()]))
            .mockResolvedValueOnce(new Response(null, { status: 204 }));
        await expect(
            mutateResource(
                {
                    fetch: confirmed,
                    request: new Request('http://localhost', { method: 'POST', body: form({ confirm: 'yes' }) }),
                    params: { resource: 'projects', id: '1' },
                },
                'delete',
            ),
        ).rejects.toMatchObject({ status: 303, location: '/admin/projects?saved=delete' });
    });

    it('keeps input after authoritative composed-schema validation fails', async () => {
        const fetch = vi
            .fn()
            .mockResolvedValueOnce(Response.json([fields(field())]))
            .mockResolvedValueOnce(
                Response.json({ error: { issues: [{ path: ['name'], message: 'Too short' }] } }, { status: 400 }),
            );
        const result = await mutateResource(
            {
                fetch,
                request: new Request('http://localhost', { method: 'POST', body: form({ name: 'x' }) }),
                params: { resource: 'projects' },
            },
            'create',
        );
        expect(result?.status).toBe(400);
        expect(result?.data.values).toEqual({ name: 'x' });
        expect(result?.data.fields.name).toEqual(['Too short']);
    });

    it('rejects invalid list options and never reads records for unavailable capabilities', async () => {
        const fetch = vi.fn();
        const noRead = { ...resource(), capabilities: { ...resource().capabilities, list: false, retrieve: false } };
        expect(
            (await loadResourceData(fetch, { resource: noRead, view: 'list' }, new URL('http://localhost'))).rows,
        ).toEqual([]);
        expect(fetch).not.toHaveBeenCalled();
        expect(
            (
                await loadResourceData(
                    fetch,
                    { resource: resource(), view: 'list' },
                    new URL('http://localhost?limit=999'),
                )
            ).message,
        ).toContain('valid list');
        expect(fetch).not.toHaveBeenCalled();
    });
});
