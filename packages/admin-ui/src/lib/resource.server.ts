import type { AdminResourceMetadata } from '@nestrum/admin';
import { fail, redirect } from '@sveltejs/kit';
import type { AdminRecord } from './crud.js';
import { AdminCrudError, AdminResourceClient, recordHref, recordId } from './crud.js';
import type { FormFeedback } from './fields.js';
import { parseResourceForm } from './fields.js';
import type { AdminFetch } from './metadata.js';
import { loadAdminState } from './metadata.js';
import type { AdminWorkspace } from './routes.js';
import { resourceHref } from './routes.js';

type MutationEvent = { fetch: AdminFetch; request: Request; params: { resource?: string; id?: string } };
type Mutation = 'create' | 'update' | 'delete';
const EMPTY_FEEDBACK: FormFeedback = { message: '', fields: {}, values: {}, modes: {} };

export async function mutateResource(event: MutationEvent, operation: Mutation) {
    const state = await loadAdminState(event.fetch);
    if (state.status !== 'ready') {
        return fail(state.status === 'sign-in' ? 401 : state.status === 'denied' ? 403 : 503, {
            ...EMPTY_FEEDBACK,
            message: state.message,
        });
    }
    const resource = state.resources.find((candidate) => candidate.slug === event.params.resource);
    if (!resource?.capabilities[operation] || (operation !== 'create' && event.params.id === undefined)) {
        return fail(403, { ...EMPTY_FEEDBACK, message: 'This operation is unavailable.' });
    }
    const id = recordId(event.params.id ?? '');
    let feedback = { ...EMPTY_FEEDBACK };
    let destination = resourceHref(resource);
    try {
        const data = await event.request.formData();
        const client = new AdminResourceClient(event.fetch);
        if (operation === 'delete') {
            if (
                data.get('confirm') !== 'yes' ||
                data.getAll('confirm').length !== 1 ||
                [...data.keys()].some((name) => name !== 'confirm')
            ) {
                return fail(400, { ...feedback, message: 'Confirm deletion before continuing.' });
            }
            await client.delete(resource, id);
        } else {
            const parsed = parseResourceForm(resource, operation, data);
            feedback = parsed.feedback;
            if (feedback.message) {
                return fail(400, feedback);
            }
            if (operation === 'create') {
                const created = await client.create(resource, parsed.body);
                destination = resource.capabilities.retrieve
                    ? (recordHref(resource, created) ?? destination)
                    : destination;
            } else {
                await client.update(resource, id, parsed.body);
                destination = resource.capabilities.retrieve
                    ? (recordHref(resource, { [resource.primaryKey]: id }) ?? destination)
                    : destination;
            }
        }
    } catch (error) {
        const failure =
            error instanceof AdminCrudError
                ? error
                : new AdminCrudError(503, 'Unable to complete the request. Please try again.');
        return fail(failure.status, { ...feedback, message: failure.message, fields: failure.fields });
    }

    redirect(303, `${destination}?saved=${operation}`);
}

export async function runResourceAction(event: MutationEvent) {
    const state = await loadAdminState(event.fetch);
    if (state.status !== 'ready') {
        return fail(state.status === 'sign-in' ? 401 : state.status === 'denied' ? 403 : 503, {
            ...EMPTY_FEEDBACK,
            message: state.message,
        });
    }
    const resource = state.resources.find((candidate) => candidate.slug === event.params.resource);
    if (!resource || event.params.id === undefined) {
        return fail(404, { ...EMPTY_FEEDBACK, message: 'The resource is unavailable.' });
    }
    let feedback = { ...EMPTY_FEEDBACK };
    try {
        const data = await event.request.formData();
        const action = data.get('action');
        const raw = data.get('input');
        if (typeof action !== 'string' || !resource.actions.some((candidate) => candidate.name === action)) {
            return fail(403, { ...feedback, message: 'This action is unavailable.' });
        }
        if (
            [...data.keys()].some((name) => !['action', 'input'].includes(name)) ||
            data.getAll('action').length !== 1 ||
            data.getAll('input').length > 1 ||
            (raw !== null && typeof raw !== 'string')
        ) {
            return fail(400, { ...feedback, message: 'Invalid action form.' });
        }
        feedback = { ...feedback, values: { action, input: typeof raw === 'string' ? raw : '{}' } };
        let input: unknown;
        try {
            input = JSON.parse(typeof raw === 'string' && raw.trim() ? raw : '{}');
        } catch {
            return fail(400, { ...feedback, message: 'Enter a valid JSON object for action input.' });
        }
        if (input === null || typeof input !== 'object' || Array.isArray(input)) {
            return fail(400, { ...feedback, message: 'Action input must be a JSON object.' });
        }
        await new AdminResourceClient(event.fetch).action(
            resource,
            recordId(event.params.id),
            action,
            input as AdminRecord,
        );
    } catch (error) {
        const failure =
            error instanceof AdminCrudError
                ? error
                : new AdminCrudError(503, 'Unable to complete the action. Please try again.');
        return fail(failure.status, { ...feedback, message: failure.message, fields: failure.fields });
    }

    redirect(
        303,
        `${recordHref(resource, { [resource.primaryKey]: recordId(event.params.id) }) ?? resourceHref(resource)}?saved=action`,
    );
}

export async function loadResourceData(fetch: AdminFetch, workspace: AdminWorkspace | null, url: URL) {
    let rows: AdminRecord[] = [];
    let record: AdminRecord | null = null;
    let message = '';
    const limit = Number(url.searchParams.get('limit') ?? 20);
    const orderBy = url.searchParams.get('orderBy') ?? '';
    if (workspace) {
        const resource: AdminResourceMetadata = workspace.resource;
        try {
            const client = new AdminResourceClient(fetch);
            if (workspace.view === 'list' && resource.capabilities.list) {
                const fields = new Set(resource.fields.map((field) => field.name));
                if (![20, 50, 100].includes(limit) || (orderBy && !fields.has(orderBy.replace(/^-/, '')))) {
                    throw new AdminCrudError(400, 'Choose a valid list limit and ordering.');
                }
                rows = await client.list(resource, limit, orderBy);
            }
            if (workspace.view === 'detail' && resource.capabilities.retrieve) {
                record = await client.retrieve(resource, workspace.id ?? '');
            }
        } catch (error) {
            message = error instanceof AdminCrudError ? error.message : 'Unable to load records. Please try again.';
        }
    }

    return { rows, record, message, limit, orderBy, saved: url.searchParams.get('saved') ?? '' };
}
