import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { AdminFetch } from './metadata.js';

const DOMAIN_STATE = z.enum(['verified', 'unverified', 'pending', 'not-required']);
const BASE = {
    id: z.string(),
    providerId: z.string(),
    displayName: z.string(),
    enabled: z.boolean(),
    organizationId: z.string().nullable(),
    domains: z.array(z.string()),
    domainVerification: DOMAIN_STATE,
    lastValidatedAt: z.string().nullable(),
    lastValidationStatus: z.enum(['passed', 'failed']).nullable(),
    lastSuccessfulLoginAt: z.string().nullable(),
};
const OIDC = z.object({
    ...BASE,
    type: z.literal('oidc'),
    issuer: z.string(),
    clientId: z.string(),
    clientSecretConfigured: z.boolean(),
    redirectUri: z.string(),
    advanced: z
        .object({
            scopes: z.array(z.string()).optional(),
            pkce: z.boolean().optional(),
            discoveryEndpoint: z.string().optional(),
            authorizationEndpoint: z.string().optional(),
            tokenEndpoint: z.string().optional(),
            jwksEndpoint: z.string().optional(),
            userInfoEndpoint: z.string().optional(),
            tokenEndpointAuthentication: z.string().optional(),
        })
        .passthrough(),
});
const SAML = z.object({
    ...BASE,
    type: z.literal('saml'),
    idpEntityId: z.string().nullable(),
    idpMetadataConfigured: z.boolean(),
    serviceProvider: z.object({
        acsUrl: z.string(),
        entityId: z.string(),
        metadataUrl: z.string(),
        callbackUrl: z.string(),
    }),
    advanced: z
        .object({
            entryPoint: z.string().optional(),
            wantAssertionsSigned: z.boolean().optional(),
            identifierFormat: z.string().optional(),
            audience: z.string().optional(),
            idpInitiatedCallbackUrl: z.string().optional(),
        })
        .passthrough(),
});
const PROVIDER = z.discriminatedUnion('type', [OIDC, SAML]);
const TEST_RESULT = z.object({
    providerId: z.string(),
    type: z.enum(['oidc', 'saml']),
    valid: z.boolean(),
    testedAt: z.string(),
    diagnostics: z.array(z.object({ code: z.string(), severity: z.enum(['error', 'warning']), message: z.string() })),
});
const VERIFICATION = z.object({
    providerId: z.string(),
    status: DOMAIN_STATE,
    domains: z.array(z.string()),
    recordName: z.string().nullable(),
    recordValue: z.string().nullable(),
    expiresAt: z.string().nullable(),
});
const CAPABILITIES = z.object({
    enabled: z.boolean(),
    read: z.boolean(),
    create: z.boolean(),
    update: z.boolean(),
    delete: z.boolean(),
    enable: z.boolean(),
    disable: z.boolean(),
    test: z.boolean(),
});
const ERROR_SCHEMA = z.object({ error: z.object({ code: z.string() }) });

export type SsoProviderRow = z.infer<typeof PROVIDER>;
export type SsoCapabilities = z.infer<typeof CAPABILITIES>;
export type SsoTestPanel = z.infer<typeof TEST_RESULT>;
export type SsoVerification = z.infer<typeof VERIFICATION>;

export class SsoAdminError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = 'SsoAdminError';
    }
}

/** Fixed, safe messages; response bodies are never echoed to the page. */
function safeMessage(status: number, code: string | undefined): string {
    switch (code) {
        case 'SSO_PROVIDER_EXISTS':
            return 'A provider with that ID already exists.';
        case 'SSO_PROVIDER_ID_RESERVED':
            return 'That provider ID is reserved. Choose another.';
        case 'SSO_PROVIDER_NOT_FOUND':
            return 'That provider no longer exists.';
        case 'SSO_DOMAIN_VERIFICATION_FAILED':
            return 'The DNS record was not found. Add the TXT record and try again later.';
        default:
    }
    if (status === 401) {
        return 'Your session has expired. Sign in again.';
    }
    if (status === 403) {
        return 'You do not have permission to do that.';
    }
    if (status === 404) {
        return 'That provider no longer exists.';
    }
    if (status === 409) {
        return 'That action is not available for this provider.';
    }
    if (status === 422) {
        return 'The configuration did not validate. Check the issuer or IdP metadata, certificates and URLs, then run Test.';
    }
    if (status === 400) {
        return 'That request is not valid. Check the provider ID, domains and required fields.';
    }

    return 'Unable to complete the request. Please try again.';
}

export class SsoAdminClient {
    constructor(private readonly fetch: AdminFetch) {}

    private async request(path: string, init: RequestInit = {}): Promise<unknown> {
        let response: Response;
        try {
            response = await this.fetch(`/__admin/auth/sso${path}`, {
                credentials: 'same-origin',
                cache: 'no-store',
                ...init,
                headers: {
                    accept: 'application/json',
                    ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
                },
            });
        } catch {
            throw new SsoAdminError(503, safeMessage(503, undefined));
        }
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) {
            throw new SsoAdminError(
                response.status,
                safeMessage(response.status, ERROR_SCHEMA.safeParse(payload).data?.error.code),
            );
        }

        return payload;
    }

    private parse<T>(schema: z.ZodType<T>, value: unknown): T {
        const parsed = schema.safeParse(value);
        if (!parsed.success) {
            throw new SsoAdminError(502, safeMessage(502, undefined));
        }

        return parsed.data;
    }

    async capabilities(): Promise<SsoCapabilities | null> {
        try {
            return CAPABILITIES.parse(await this.request('/capabilities'));
        } catch {
            return null;
        }
    }

    async list(): Promise<SsoProviderRow[]> {
        return this.parse(z.object({ providers: z.array(PROVIDER) }), await this.request('')).providers;
    }

    async get(providerId: string): Promise<SsoProviderRow> {
        return this.parse(z.object({ provider: PROVIDER }), await this.request(`/${encodeURIComponent(providerId)}`))
            .provider;
    }

    async create(body: object): Promise<SsoProviderRow> {
        return this.parse(
            z.object({ provider: PROVIDER }),
            await this.request('', { method: 'POST', body: JSON.stringify(body) }),
        ).provider;
    }

    async update(providerId: string, body: object): Promise<SsoProviderRow> {
        return this.parse(
            z.object({ provider: PROVIDER }),
            await this.request(`/${encodeURIComponent(providerId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
        ).provider;
    }

    async setEnabled(providerId: string, enabled: boolean): Promise<SsoProviderRow> {
        return this.parse(
            z.object({ provider: PROVIDER }),
            await this.request(`/${encodeURIComponent(providerId)}/${enabled ? 'enable' : 'disable'}`, {
                method: 'POST',
            }),
        ).provider;
    }

    async test(providerId: string): Promise<SsoTestPanel> {
        return this.parse(
            z.object({ result: TEST_RESULT }),
            await this.request(`/${encodeURIComponent(providerId)}/test`, { method: 'POST' }),
        ).result;
    }

    async remove(providerId: string): Promise<void> {
        await this.request(`/${encodeURIComponent(providerId)}`, { method: 'DELETE' });
    }

    async requestVerification(providerId: string): Promise<SsoVerification> {
        return this.parse(
            z.object({ verification: VERIFICATION }),
            await this.request(`/${encodeURIComponent(providerId)}/domain-verification`, { method: 'POST' }),
        ).verification;
    }

    async verify(providerId: string): Promise<SsoProviderRow> {
        return this.parse(
            z.object({ provider: PROVIDER }),
            await this.request(`/${encodeURIComponent(providerId)}/domain-verification/verify`, { method: 'POST' }),
        ).provider;
    }
}

export async function loadSsoList(fetch: AdminFetch) {
    const client = new SsoAdminClient(fetch);
    const capabilities = await client.capabilities();
    if (!capabilities?.enabled) {
        return { providers: null, capabilities, message: 'Enterprise SSO is not enabled for this application.' };
    }
    if (!capabilities.read) {
        return { providers: null, capabilities, message: 'You do not have permission to manage SSO providers.' };
    }
    try {
        return { providers: await client.list(), capabilities, message: '' };
    } catch (error) {
        return { providers: null, capabilities, message: known(error).message };
    }
}

export async function loadSsoDetail(fetch: AdminFetch, providerId: string) {
    const client = new SsoAdminClient(fetch);
    const capabilities = await client.capabilities();
    if (!capabilities?.enabled || !capabilities.read) {
        return { provider: null, capabilities, message: 'You do not have permission to manage SSO providers.' };
    }
    try {
        return { provider: await client.get(providerId), capabilities, message: '' };
    } catch (error) {
        return { provider: null, capabilities, message: known(error).message };
    }
}

export async function loadSsoNew(fetch: AdminFetch, url: URL) {
    const capabilities = await new SsoAdminClient(fetch).capabilities();

    return {
        capabilities,
        type: url.searchParams.get('type') === 'saml' ? ('saml' as const) : ('oidc' as const),
        message:
            capabilities?.enabled && capabilities.create ? '' : 'You do not have permission to create SSO providers.',
    };
}

function known(error: unknown): SsoAdminError {
    return error instanceof SsoAdminError ? error : new SsoAdminError(503, safeMessage(503, undefined));
}

const invalid = () => fail(400, { message: 'That request is not valid.' });

/** Text inputs only: exactly one value for each allowed name, and nothing else. */
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

const list = (value: string | undefined) => (value ?? '').split(/[\s,]+/).filter(Boolean);

const COMMON = ['type', 'providerId', 'displayName', 'organizationId', 'domains', 'enabled'] as const;
const OIDC_FIELDS = [
    'issuer',
    'clientId',
    'clientSecret',
    'scopes',
    'pkce',
    'discoveryEndpoint',
    'authorizationEndpoint',
    'tokenEndpoint',
    'jwksEndpoint',
    'userInfoEndpoint',
    'tokenEndpointAuthentication',
    'mapEmail',
    'mapName',
    'mapId',
] as const;
const SAML_FIELDS = [
    'idpMetadata',
    'entryPoint',
    'cert',
    'wantAssertionsSigned',
    'identifierFormat',
    'audience',
    'idpInitiatedCallbackUrl',
    'mapEmail',
    'mapName',
    'mapId',
] as const;

function withDefined<T extends Record<string, unknown>>(value: T): Partial<T> {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

function mapping(input: Record<string, string>) {
    const mapped = withDefined({
        id: input.mapId || undefined,
        email: input.mapEmail || undefined,
        name: input.mapName || undefined,
    });

    return Object.keys(mapped).length ? mapped : undefined;
}

/** Builds the request body from a provider form. `create` requires the secret; an edit omits blanks to keep values. */
function providerBody(data: FormData, create: boolean): { body: object; providerId: string } | null {
    const type = data.get('type');
    if (type !== 'oidc' && type !== 'saml') {
        return null;
    }
    const input = fields(data, [...COMMON, ...(type === 'oidc' ? OIDC_FIELDS : SAML_FIELDS)]);
    if (!input?.providerId || !input.displayName) {
        return null;
    }
    const checked = (name: string) => (input[name] === 'on' ? true : undefined);
    const common = {
        displayName: input.displayName,
        organizationId: input.organizationId ? input.organizationId : null,
        domains: list(input.domains),
        ...(create ? { enabled: input.enabled === 'on' } : {}),
    };
    if (type === 'oidc') {
        const scopes = list(input.scopes);
        const advanced = withDefined({
            scopes: scopes.length ? scopes : undefined,
            pkce: create || input.pkce !== undefined ? checked('pkce') === true : undefined,
            discoveryEndpoint: input.discoveryEndpoint || undefined,
            authorizationEndpoint: input.authorizationEndpoint || undefined,
            tokenEndpoint: input.tokenEndpoint || undefined,
            jwksEndpoint: input.jwksEndpoint || undefined,
            userInfoEndpoint: input.userInfoEndpoint || undefined,
            tokenEndpointAuthentication: input.tokenEndpointAuthentication || undefined,
            mapping: mapping(input),
        });
        if (!input.issuer || !input.clientId || (create && !input.clientSecret)) {
            return null;
        }

        return {
            providerId: input.providerId,
            body: {
                ...(create ? { type, providerId: input.providerId } : {}),
                ...common,
                issuer: input.issuer,
                clientId: input.clientId,
                ...(input.clientSecret ? { clientSecret: input.clientSecret } : {}),
                ...(Object.keys(advanced).length ? { advanced } : {}),
            },
        };
    }
    const advanced = withDefined({
        entryPoint: input.entryPoint || undefined,
        cert: input.cert || undefined,
        wantAssertionsSigned:
            create || input.wantAssertionsSigned !== undefined ? checked('wantAssertionsSigned') === true : undefined,
        identifierFormat: input.identifierFormat || undefined,
        audience: input.audience || undefined,
        idpInitiatedCallbackUrl: input.idpInitiatedCallbackUrl || undefined,
        mapping: mapping(input),
    });

    return {
        providerId: input.providerId,
        body: {
            ...(create ? { type, providerId: input.providerId } : {}),
            ...common,
            ...(input.idpMetadata ? { idpMetadata: input.idpMetadata } : {}),
            ...(Object.keys(advanced).length ? { advanced } : {}),
        },
    };
}

type ActionEvent = { fetch: AdminFetch; request: Request };

export async function createProvider(event: ActionEvent) {
    const parsed = providerBody(await event.request.formData(), true);
    if (!parsed) {
        return invalid();
    }
    try {
        await new SsoAdminClient(event.fetch).create(parsed.body);
    } catch (error) {
        const failure = known(error);

        return fail(failure.status, { message: failure.message });
    }
    redirect(303, `/admin/auth/sso/${encodeURIComponent(parsed.providerId)}`);
}

export async function updateProvider(event: ActionEvent) {
    const parsed = providerBody(await event.request.formData(), false);
    if (!parsed) {
        return invalid();
    }
    try {
        await new SsoAdminClient(event.fetch).update(parsed.providerId, parsed.body);
    } catch (error) {
        const failure = known(error);

        return fail(failure.status, { message: failure.message });
    }

    return { saved: true, message: '' };
}

/** A single hidden `providerId`, nothing else. */
async function providerId(request: Request, extra: readonly string[] = []): Promise<string | null> {
    const data = await request.formData();
    const input = fields(data, ['providerId', ...extra]);
    if (!input?.providerId || input.providerId.length > 64) {
        return null;
    }
    for (const name of extra) {
        if (input[name] !== 'on' && input[name] !== input.providerId) {
            return null;
        }
    }

    return input.providerId;
}

export async function toggleProvider(event: ActionEvent, enabled: boolean) {
    const id = await providerId(event.request);
    if (id === null) {
        return invalid();
    }
    try {
        await new SsoAdminClient(event.fetch).setEnabled(id, enabled);
    } catch (error) {
        const failure = known(error);

        return fail(failure.status, { message: failure.message });
    }

    return { toggled: enabled ? 'enabled' : 'disabled', message: '' };
}

/** The panel states that a passing test checks configuration only; it is never a login. */
export async function testProvider(event: ActionEvent) {
    const id = await providerId(event.request);
    if (id === null) {
        return invalid();
    }
    try {
        return { test: await new SsoAdminClient(event.fetch).test(id), message: '' };
    } catch (error) {
        const failure = known(error);

        return fail(failure.status, { message: failure.message });
    }
}

/** Deleting needs the provider ID typed back as confirmation. */
export async function deleteProvider(event: ActionEvent) {
    const id = await providerId(event.request, ['confirm']);
    if (id === null) {
        return fail(400, { message: 'Type the provider ID to confirm deletion.' });
    }
    try {
        await new SsoAdminClient(event.fetch).remove(id);
    } catch (error) {
        const failure = known(error);

        return fail(failure.status, { message: failure.message });
    }
    redirect(303, '/admin/auth/sso');
}

export async function requestVerification(event: ActionEvent) {
    const id = await providerId(event.request);
    if (id === null) {
        return invalid();
    }
    try {
        return { verification: await new SsoAdminClient(event.fetch).requestVerification(id), message: '' };
    } catch (error) {
        const failure = known(error);

        return fail(failure.status, { message: failure.message });
    }
}

export async function verifyDomain(event: ActionEvent) {
    const id = await providerId(event.request);
    if (id === null) {
        return invalid();
    }
    try {
        await new SsoAdminClient(event.fetch).verify(id);
    } catch (error) {
        const failure = known(error);

        return fail(failure.status, { message: failure.message });
    }

    return { verified: true, message: '' };
}
