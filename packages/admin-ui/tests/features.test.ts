import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import { explainFlag, FeatureAdminClient, loadFeatureData, removeRule, saveRule } from '../src/lib/features.server.js';
import { load as loadLayout } from '../src/routes/+layout.server.js';
import FeaturesPage from '../src/routes/features/+page.svelte';
import { resource } from './fixtures.js';
import ShellFixture from './ShellFixture.svelte';

const RULE = {
    id: 'r1',
    scope: 'organization',
    target: 'acme',
    enabled: true,
    percentage: null,
    updatedBy: 'admin-1',
    updatedAt: '2026-01-01T10:20:00.000Z',
};
const FLAGS = {
    flags: [
        {
            name: 'newDashboard',
            default: false,
            exposeToClient: true,
            description: 'Redesigned dashboard',
            rules: [RULE],
        },
        { name: 'experimentalSearch', default: true, exposeToClient: false, rules: [] },
    ],
};
const MANAGE = { read: true, manage: true };
function form(values: Record<string, string | string[]>) {
    const data = new FormData();
    for (const [name, value] of Object.entries(values)) {
        for (const item of Array.isArray(value) ? value : [value]) {
            data.append(name, item);
        }
    }

    return new Request('http://localhost/admin/features?/save', { method: 'POST', body: data });
}
type Result = { status: number; data: { message: string } };

describe('feature admin client', () => {
    it('requests credentialed, uncached JSON and treats failures as no capability', async () => {
        const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => Response.json(FLAGS));
        expect((await new FeatureAdminClient(fetch).list()).map((flag) => flag.name)).toEqual([
            'newDashboard',
            'experimentalSearch',
        ]);
        expect(fetch.mock.calls[0]?.[0]).toBe('/__admin/features');
        expect(fetch.mock.calls[0]?.[1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store' });
        expect(await new FeatureAdminClient(async () => Response.json(MANAGE)).capabilities()).toEqual(MANAGE);
        expect(await new FeatureAdminClient(async () => Response.json({ read: 1 })).capabilities()).toBeNull();
        expect(await new FeatureAdminClient(async () => Response.json({}, { status: 403 })).capabilities()).toBeNull();
        await expect(new FeatureAdminClient(async () => Response.json({ flags: [{}] })).list()).rejects.toMatchObject({
            status: 502,
        });
    });

    it('shows the layout link only when the API says the subject can read features', async () => {
        const event = (read: boolean) =>
            ({
                fetch: vi.fn(async (input: string | URL | Request) =>
                    String(input).endsWith('/features/capabilities')
                        ? Response.json({ read, manage: false })
                        : Response.json(String(input).endsWith('/capabilities') ? { users: false } : [resource()]),
                ),
                depends: vi.fn(),
                url: new URL('http://localhost/admin'),
            }) as never;
        expect((await loadLayout(event(true))).canViewFeatures).toBe(true);
        expect((await loadLayout(event(false))).canViewFeatures).toBe(false);
        const { body } = render(ShellFixture, {
            props: { state: { status: 'ready', resources: [], user: null } as never, canViewFeatures: true },
        });
        expect(body).toContain('href="/admin/features"');
    });
});

describe('feature admin page data and actions', () => {
    it('loads flags for a permitted subject and explains a denial without data', async () => {
        const fetch = vi.fn(async (input: string | URL | Request) =>
            String(input).endsWith('/capabilities') ? Response.json(MANAGE) : Response.json(FLAGS),
        );
        expect(await loadFeatureData(fetch)).toMatchObject({ flags: FLAGS.flags, capabilities: MANAGE, message: '' });
        expect(await loadFeatureData(async () => Response.json({ read: false, manage: false }))).toMatchObject({
            flags: null,
            message: 'You do not have permission to view feature flags.',
        });
        const failing = vi.fn(async (input: string | URL | Request) =>
            String(input).endsWith('/capabilities') ? Response.json(MANAGE) : Response.json({}, { status: 500 }),
        );
        expect((await loadFeatureData(failing)).message).toBe('Unable to complete the request. Please try again.');
    });

    it('validates form input before calling the admin API and sends only allowed fields', async () => {
        const fetch = vi.fn(async () => Response.json({ rule: RULE }));
        const send = (values: Record<string, string | string[]>) => saveRule({ fetch, request: form(values) });
        expect(await send({ flag: 'newDashboard', scope: 'organization', target: 'acme', enabled: 'true' })).toEqual({
            saved: 'newDashboard',
            message: '',
        });
        expect(fetch).toHaveBeenLastCalledWith(
            '/__admin/features/newDashboard/rules',
            expect.objectContaining({
                method: 'PUT',
                body: JSON.stringify({ scope: 'organization', enabled: true, target: 'acme' }),
            }),
        );
        await send({ flag: 'newDashboard', scope: 'global', enabled: 'false', target: 'ignored' });
        expect(JSON.parse((fetch.mock.lastCall as unknown as [string, RequestInit])[1].body as string)).toEqual({
            scope: 'global',
            enabled: false,
        });
        await send({ flag: 'newDashboard', scope: 'percentage', percentage: '12.5' });
        expect(JSON.parse((fetch.mock.lastCall as unknown as [string, RequestInit])[1].body as string)).toEqual({
            scope: 'percentage',
            percentage: 12.5,
        });
        const calls = fetch.mock.calls.length;
        for (const values of [
            { flag: 'Bad Flag', scope: 'global', enabled: 'true' },
            { flag: 'newDashboard', scope: 'nope', enabled: 'true' },
            { flag: 'newDashboard', scope: 'global', enabled: 'maybe' },
            { flag: 'newDashboard', scope: 'percentage', percentage: '101' },
            { flag: 'newDashboard', scope: 'percentage', percentage: '5.555' },
            { flag: 'newDashboard', scope: 'percentage' },
            { flag: 'newDashboard', scope: 'global', enabled: 'true', extra: 'x' },
            { flag: ['newDashboard', 'other'], scope: 'global', enabled: 'true' },
            { flag: 'newDashboard', scope: 'subject', target: 'x'.repeat(257), enabled: 'true' },
        ]) {
            expect(((await send(values)) as unknown as Result).status, JSON.stringify(values)).toBe(400);
        }
        expect(fetch).toHaveBeenCalledTimes(calls);
    });

    it('maps API failures to fixed messages and never echoes response bodies', async () => {
        const denied = await saveRule({
            fetch: async () => Response.json({ error: { code: 'X', message: 'SECRET internals' } }, { status: 403 }),
            request: form({ flag: 'newDashboard', scope: 'global', enabled: 'true' }),
        });
        expect((denied as unknown as Result).data.message).toBe('You do not have permission to do that.');
        const invalid = await saveRule({
            fetch: async () => Response.json({ error: { code: 'FEATURE_RULE_INVALID' } }, { status: 400 }),
            request: form({ flag: 'newDashboard', scope: 'global', enabled: 'true' }),
        });
        expect((invalid as unknown as Result).data.message).toContain('not valid');
        const offline = await removeRule({
            fetch: async () => {
                throw new Error('connection refused to internal-host');
            },
            request: form({ flag: 'newDashboard', scope: 'global' }),
        });
        expect(JSON.stringify(offline)).not.toContain('internal-host');
    });

    it('removes overrides and returns explanations without extra fields', async () => {
        const fetch = vi.fn(async (input: string | URL | Request) =>
            String(input).includes('/explain')
                ? Response.json({
                      evaluation: { flag: 'newDashboard', enabled: true, reason: { source: 'subject', target: 'u1' } },
                  })
                : new Response(null, { status: 204 }),
        );
        expect(
            await removeRule({ fetch, request: form({ flag: 'newDashboard', scope: 'subject', target: 'u1' }) }),
        ).toEqual({
            removed: 'newDashboard',
            message: '',
        });
        expect(fetch).toHaveBeenLastCalledWith(
            '/__admin/features/newDashboard/rules?scope=subject&target=u1',
            expect.objectContaining({ method: 'DELETE' }),
        );
        const explained = await explainFlag({
            fetch,
            request: form({ flag: 'newDashboard', subjectId: 'u1', organizationId: '', environment: 'production' }),
        });
        expect(explained).toMatchObject({ explanation: { enabled: true, reason: { source: 'subject' } } });
        expect(JSON.parse((fetch.mock.lastCall as unknown as [string, RequestInit])[1].body as string)).toEqual({
            subjectId: 'u1',
            environment: 'production',
        });
        expect(
            ((await explainFlag({ fetch, request: form({ flag: 'x', attributes: '{}' }) })) as unknown as Result)
                .status,
        ).toBe(400);
    });
});

describe('feature admin page', () => {
    const page = (data: object, formData?: object) =>
        render(FeaturesPage, { props: { data: data as never, form: formData as never, params: {} } as never }).body;

    it('renders flags, defaults, exposure and overrides, and management controls only when permitted', () => {
        const managed = page({ flags: FLAGS.flags, capabilities: MANAGE, message: '' });
        expect(managed).toContain('newDashboard');
        expect(managed).toContain('Redesigned dashboard');
        expect(managed).toContain('Default: off');
        expect(managed).toContain('Evaluated value is sent to the consumer UI.');
        expect(managed).toContain('organization acme: on');
        expect(managed).toContain('action="?/save"');
        expect(managed).toContain('action="?/remove"');
        const readOnly = page({ flags: FLAGS.flags, capabilities: { read: true, manage: false }, message: '' });
        expect(readOnly).toContain('organization acme: on');
        expect(readOnly).not.toContain('action="?/save"');
        expect(readOnly).not.toContain('action="?/remove"');
        expect(readOnly).toContain('action="?/explain"');
    });

    it('shows denials and results as accessible status text', () => {
        expect(
            page({ flags: null, capabilities: null, message: 'You do not have permission to view feature flags.' }),
        ).toContain('role="alert"');
        const explained = page(
            { flags: FLAGS.flags, capabilities: MANAGE, message: '' },
            {
                explanation: { flag: 'newDashboard', enabled: true, reason: { source: 'percentage', percentage: 25 } },
                message: '',
            },
        );
        expect(explained).toContain('On because of percentage (25%).');
        expect(page({ flags: [], capabilities: MANAGE, message: '' })).toContain('No feature flags are declared.');
    });
});
