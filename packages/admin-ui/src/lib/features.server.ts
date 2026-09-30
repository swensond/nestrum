import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import type { AdminFetch } from './metadata.js';

const SCOPES = ['subject', 'organization', 'percentage', 'environment', 'global'] as const;
const RULE_SCHEMA = z.object({
    id: z.string().min(1),
    scope: z.enum(SCOPES),
    target: z.string(),
    enabled: z.boolean(),
    percentage: z.number().nullable(),
    updatedBy: z.string().nullable(),
    updatedAt: z.string(),
});
const FLAG_SCHEMA = z.object({
    name: z.string().min(1),
    default: z.boolean(),
    exposeToClient: z.boolean(),
    description: z.string().optional(),
    rules: z.array(RULE_SCHEMA),
});
const LIST_SCHEMA = z.object({ flags: z.array(FLAG_SCHEMA) });
const CAPABILITIES_SCHEMA = z.object({ read: z.boolean(), manage: z.boolean() });
const EXPLAIN_SCHEMA = z.object({
    evaluation: z.object({
        flag: z.string(),
        enabled: z.boolean(),
        reason: z.object({ source: z.string(), target: z.string().optional(), percentage: z.number().optional() }),
    }),
});
const ERROR_SCHEMA = z.object({ error: z.object({ code: z.string() }) });

export type FeatureFlagRow = z.infer<typeof FLAG_SCHEMA>;
export type FeatureCapabilities = z.infer<typeof CAPABILITIES_SCHEMA>;
export type FeatureExplanation = z.infer<typeof EXPLAIN_SCHEMA>['evaluation'];

export class FeatureAdminError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = 'FeatureAdminError';
    }
}

/** Fixed, safe messages; response bodies are never echoed to the page. */
function safeMessage(status: number, code: string | undefined): string {
    switch (code) {
        case 'FEATURE_RULE_INVALID':
            return 'That override is not valid. Check the target and percentage.';
        case 'FEATURE_UNKNOWN':
            return 'That feature flag is not declared.';
        case 'FEATURE_RULE_NOT_FOUND':
            return 'That override no longer exists.';
        default:
    }
    if (status === 401) {
        return 'Your session has expired. Sign in again.';
    }
    if (status === 403) {
        return 'You do not have permission to do that.';
    }
    if (status === 404) {
        return 'That feature or override no longer exists.';
    }
    if (status === 400) {
        return 'That request is not valid.';
    }

    return 'Unable to complete the request. Please try again.';
}

export class FeatureAdminClient {
    constructor(private readonly fetch: AdminFetch) {}

    private async request(path: string, init: RequestInit = {}): Promise<unknown> {
        let response: Response;
        try {
            response = await this.fetch(`/__admin/features${path}`, {
                credentials: 'same-origin',
                cache: 'no-store',
                ...init,
                headers: {
                    accept: 'application/json',
                    ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
                },
            });
        } catch {
            throw new FeatureAdminError(503, safeMessage(503, undefined));
        }
        if (response.status === 204) {
            return null;
        }
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) {
            throw new FeatureAdminError(
                response.status,
                safeMessage(response.status, ERROR_SCHEMA.safeParse(payload).data?.error.code),
            );
        }

        return payload;
    }

    /** What the current subject may do; any failure means nothing. */
    async capabilities(): Promise<FeatureCapabilities | null> {
        try {
            return CAPABILITIES_SCHEMA.parse(await this.request('/capabilities'));
        } catch {
            return null;
        }
    }

    async list(): Promise<FeatureFlagRow[]> {
        const parsed = LIST_SCHEMA.safeParse(await this.request(''));
        if (!parsed.success) {
            throw new FeatureAdminError(502, safeMessage(502, undefined));
        }

        return parsed.data.flags;
    }

    async setRule(flag: string, body: object): Promise<void> {
        await this.request(`/${encodeURIComponent(flag)}/rules`, { method: 'PUT', body: JSON.stringify(body) });
    }

    async removeRule(flag: string, scope: string, target: string): Promise<void> {
        const query = new URLSearchParams({ scope, target });
        await this.request(`/${encodeURIComponent(flag)}/rules?${query}`, { method: 'DELETE' });
    }

    async explain(flag: string, body: object): Promise<FeatureExplanation> {
        const parsed = EXPLAIN_SCHEMA.safeParse(
            await this.request(`/${encodeURIComponent(flag)}/explain`, { method: 'POST', body: JSON.stringify(body) }),
        );
        if (!parsed.success) {
            throw new FeatureAdminError(502, safeMessage(502, undefined));
        }

        return parsed.data.evaluation;
    }
}

export async function loadFeatureData(fetch: AdminFetch) {
    const client = new FeatureAdminClient(fetch);
    const capabilities = await client.capabilities();
    if (!capabilities?.read) {
        return { flags: null, capabilities, message: 'You do not have permission to view feature flags.' };
    }
    try {
        return { flags: await client.list(), capabilities, message: '' };
    } catch (error) {
        return {
            flags: null,
            capabilities,
            message: error instanceof FeatureAdminError ? error.message : safeMessage(503, undefined),
        };
    }
}

function known(error: unknown): FeatureAdminError {
    return error instanceof FeatureAdminError ? error : new FeatureAdminError(503, safeMessage(503, undefined));
}

/** Text inputs only: at most one value for each allowed name, and nothing else. */
function fields(data: FormData, allowed: readonly string[]): Record<string, string> | null {
    if ([...data.keys()].some((name) => !allowed.includes(name))) {
        return null;
    }
    const values: Record<string, string> = {};
    for (const name of allowed) {
        const all = data.getAll(name);
        if (all.length > 1 || (all[0] !== undefined && typeof all[0] !== 'string')) {
            return null;
        }
        if (typeof all[0] === 'string') {
            values[name] = all[0].trim();
        }
    }

    return values;
}

const invalid = () => fail(400, { message: 'That request is not valid.' });
const FLAG_NAME = /^[a-z][A-Za-z0-9]{0,63}$/;
const isScope = (value: string | undefined): value is (typeof SCOPES)[number] =>
    (SCOPES as readonly (string | undefined)[]).includes(value);

/** Native-form action creating or updating one override. */
export async function saveRule(event: { fetch: AdminFetch; request: Request }) {
    const input = fields(await event.request.formData(), ['flag', 'scope', 'target', 'enabled', 'percentage']);
    if (!input?.flag || !FLAG_NAME.test(input.flag) || !isScope(input.scope) || (input.target ?? '').length > 256) {
        return invalid();
    }
    const body: Record<string, unknown> = { scope: input.scope };
    if (input.scope === 'percentage') {
        if (!/^(100|[0-9]{1,2})(\.[0-9]{1,2})?$/.test(input.percentage ?? '')) {
            return invalid();
        }
        body.percentage = Number(input.percentage);
    } else {
        if (input.enabled !== 'true' && input.enabled !== 'false') {
            return invalid();
        }
        body.enabled = input.enabled === 'true';
        if (input.scope !== 'global') {
            body.target = input.target ?? '';
        }
    }
    try {
        await new FeatureAdminClient(event.fetch).setRule(input.flag, body);
    } catch (error) {
        const failure = known(error);

        return fail(failure.status, { message: failure.message });
    }

    return { saved: input.flag, message: '' };
}

export async function removeRule(event: { fetch: AdminFetch; request: Request }) {
    const input = fields(await event.request.formData(), ['flag', 'scope', 'target']);
    if (!input?.flag || !FLAG_NAME.test(input.flag) || !isScope(input.scope) || (input.target ?? '').length > 256) {
        return invalid();
    }
    try {
        await new FeatureAdminClient(event.fetch).removeRule(input.flag, input.scope, input.target ?? '');
    } catch (error) {
        const failure = known(error);

        return fail(failure.status, { message: failure.message });
    }

    return { removed: input.flag, message: '' };
}

export async function explainFlag(event: { fetch: AdminFetch; request: Request }) {
    const input = fields(await event.request.formData(), ['flag', 'subjectId', 'organizationId', 'environment']);
    if (!input?.flag || !FLAG_NAME.test(input.flag)) {
        return invalid();
    }
    const body = Object.fromEntries(
        (['subjectId', 'organizationId', 'environment'] as const)
            .filter((name) => input[name])
            .map((name) => [name, input[name]]),
    );
    try {
        return { explanation: await new FeatureAdminClient(event.fetch).explain(input.flag, body), message: '' };
    } catch (error) {
        const failure = known(error);

        return fail(failure.status, { message: failure.message });
    }
}
