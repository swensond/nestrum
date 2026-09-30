import { X509Certificate } from 'node:crypto';
import { resolveTxt as dnsResolveTxt } from 'node:dns/promises';
import { DiscoveryError, deriveSAMLIdentityProviderEntityID, discoverOIDCConfig } from '@better-auth/sso';
import type {
    CreateSsoProviderInput,
    SsoActor,
    SsoAuditEvent,
    SsoAuditEventType,
    SsoDiagnostic,
    SsoDiscoveryChoice,
    SsoDiscoveryQuery,
    SsoDiscoveryResult,
    SsoDomainVerification,
    SsoDomainVerificationInstructions,
    SsoProviderSummary,
    SsoProviders,
    SsoTestResult,
    UpdateSsoProviderInput,
} from '@nestrum/core';
import { SSO_PROVIDER_ID_PATTERN, SsoError } from '@nestrum/core';
import { z } from 'zod';
import { assertIdpUrl } from '#auth/sso/network';
import type { ResolvedSsoOptions } from '#auth/sso/options';

type Row = Record<string, unknown>;
type Where = { field: string; value: unknown }[];
/** The slice of Better Auth's database context the registry uses. */
export type SsoStore = {
    adapter: {
        findOne(input: { model: string; where: Where }): Promise<Row | null>;
        findMany(input: { model: string; where?: Where; limit?: number }): Promise<Row[]>;
        create(input: { model: string; data: Row; forceAllowId?: boolean }): Promise<Row>;
        update(input: { model: string; where: Where; update: Row }): Promise<Row | null>;
        delete(input: { model: string; where: Where }): Promise<void>;
    };
    internalAdapter: {
        createVerificationValue(data: { identifier: string; value: string; expiresAt: Date }): Promise<unknown>;
        findVerificationValue(identifier: string): Promise<{ value: string; expiresAt: Date | string } | null>;
        deleteVerificationByIdentifier(identifier: string): Promise<unknown>;
    };
};

const MODEL = 'ssoProvider';
export const SSO_BASE_PATH = '/api/auth/sso';
const VERIFICATION_PREFIX = 'nestrum-sso';
/** Identifiers Better Auth or Nestrum already use for accounts; an SSO provider must never shadow them. */
const RESERVED_PROVIDER_IDS: ReadonlySet<string> = new Set([
    'credential',
    'email-otp',
    'magic-link',
    'phone-number',
    'anonymous',
    'siwe',
    'passkey',
    'api-key',
    'admin',
    'google',
    'github',
    'gitlab',
    'apple',
    'microsoft',
    'facebook',
    'twitter',
    'discord',
    'linkedin',
    'slack',
    'spotify',
    'okta',
    'auth0',
]);
const DOMAIN_PATTERN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const MAX_METADATA_BYTES = 100 * 1024;

const mapping = z
    .object({
        id: z.string().min(1).max(128).optional(),
        email: z.string().min(1).max(128).optional(),
        emailVerified: z.string().min(1).max(128).optional(),
        name: z.string().min(1).max(128).optional(),
        image: z.string().min(1).max(128).optional(),
        extraFields: z.record(z.string().min(1).max(64), z.string().min(1).max(128)).optional(),
    })
    .strict();
const url = z.string().max(2048);
const oidcAdvanced = z
    .object({
        scopes: z.array(z.string().min(1).max(128)).max(32).optional(),
        pkce: z.boolean().optional(),
        discoveryEndpoint: url.optional(),
        authorizationEndpoint: url.optional(),
        tokenEndpoint: url.optional(),
        jwksEndpoint: url.optional(),
        userInfoEndpoint: url.optional(),
        tokenEndpointAuthentication: z.enum(['client_secret_basic', 'client_secret_post']).optional(),
        mapping: mapping.optional(),
    })
    .strict();
const samlAdvanced = z
    .object({
        entryPoint: url.optional(),
        cert: z.string().max(20_000).optional(),
        wantAssertionsSigned: z.boolean().optional(),
        identifierFormat: z.string().max(256).optional(),
        audience: z.string().max(2048).optional(),
        idpInitiatedCallbackUrl: url.optional(),
        mapping: mapping.optional(),
    })
    .strict();
const common = {
    displayName: z.string().trim().min(1).max(100),
    organizationId: z.string().min(1).max(128).nullable().optional(),
    domains: z.array(z.string()).min(1).max(10),
    enabled: z.boolean().optional(),
};
const CREATE = z.discriminatedUnion('type', [
    z
        .object({
            type: z.literal('oidc'),
            providerId: z.string(),
            ...common,
            issuer: url,
            clientId: z.string().min(1).max(512),
            clientSecret: z.string().min(1).max(4096).optional(),
            advanced: oidcAdvanced.optional(),
        })
        .strict(),
    z
        .object({
            type: z.literal('saml'),
            providerId: z.string(),
            ...common,
            idpMetadata: z.string().max(MAX_METADATA_BYTES).optional(),
            advanced: samlAdvanced.optional(),
        })
        .strict(),
]);
const UPDATE = z
    .object({
        displayName: common.displayName.optional(),
        organizationId: common.organizationId,
        domains: common.domains.optional(),
        enabled: z.boolean().optional(),
        issuer: url.optional(),
        clientId: z.string().min(1).max(512).optional(),
        clientSecret: z.string().min(1).max(4096).optional(),
        idpMetadata: z.string().max(MAX_METADATA_BYTES).optional(),
        advanced: oidcAdvanced.partial().extend(samlAdvanced.partial().shape).optional(),
    })
    .strict();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success) {
        const issue = result.error.issues[0];
        const path = issue?.path.join('.') || 'input';
        throw new SsoError(
            'SSO_INVALID_INPUT',
            `Invalid SSO provider input at ${path}: ${issue?.message ?? 'invalid'}.`,
        );
    }

    return result.data;
}

function json(value: unknown): Row {
    if (typeof value === 'object' && value !== null) {
        return value as Row;
    }
    if (typeof value === 'string' && value) {
        try {
            const parsed: unknown = JSON.parse(value);

            return parsed && typeof parsed === 'object' ? (parsed as Row) : {};
        } catch {
            return {};
        }
    }

    return {};
}

function iso(value: unknown): string | null {
    const time = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : Number.NaN;

    return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function str(value: unknown): string | undefined {
    return typeof value === 'string' && value !== '' ? value : undefined;
}

function domainsOf(row: Row): string[] {
    return String(row.domain ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function normalizeDomains(domains: readonly string[]): string[] {
    const normalized = [...new Set(domains.map((domain) => domain.trim().toLowerCase()))];
    if (!normalized.length || normalized.some((domain) => !DOMAIN_PATTERN.test(domain))) {
        throw new SsoError('SSO_INVALID_INPUT', 'Domains must be valid DNS names such as example.com.');
    }

    return normalized;
}

function definedRecord<T extends Row>(value: T): Row {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

/** Plugin mapping key names differ slightly between the protocols; only supported keys are forwarded. */
function pluginMapping(value: z.infer<typeof mapping> | undefined, protocol: 'oidc' | 'saml'): Row | undefined {
    if (!value) {
        return undefined;
    }
    const { image, ...rest } = value;

    return definedRecord(protocol === 'oidc' ? { ...rest, image } : rest);
}

function certificateProblems(certificates: readonly string[]): boolean {
    for (const certificate of certificates) {
        try {
            const pem = certificate.includes('BEGIN CERTIFICATE')
                ? certificate
                : `-----BEGIN CERTIFICATE-----\n${certificate.replace(/\s+/g, '').replace(/(.{64})/g, '$1\n')}\n-----END CERTIFICATE-----`;
            const parsed = new X509Certificate(pem);
            if (Date.parse(parsed.validTo) < Date.now()) {
                return true;
            }
        } catch {
            return true;
        }
    }

    return false;
}

function metadataCertificates(xml: string): string[] {
    return [...xml.matchAll(/<(?:\w+:)?X509Certificate[^>]*>([^<]+)<\/(?:\w+:)?X509Certificate>/g)].map((match) =>
        (match[1] ?? '').trim(),
    );
}

export type SsoServiceDependencies = {
    readonly store: () => Promise<SsoStore>;
    readonly baseURL: string;
    readonly options: ResolvedSsoOptions;
};

/** Nestrum's provider registry over the Better Auth SSO plugin's own table. Secrets are sealed by the auth adapter. */
export class SsoRegistry implements SsoProviders {
    constructor(private readonly deps: SsoServiceDependencies) {}

    private get verification(): boolean {
        return this.deps.options.domainVerification.enabled;
    }

    private acsUrl(providerId: string): string {
        return `${this.deps.baseURL}${SSO_BASE_PATH}/saml2/sp/acs/${providerId}`;
    }

    private metadataUrl(providerId: string): string {
        return `${this.deps.baseURL}${SSO_BASE_PATH}/saml2/sp/metadata?providerId=${providerId}`;
    }

    private redirectUri(providerId: string): string {
        return `${this.deps.baseURL}${SSO_BASE_PATH}/callback/${providerId}`;
    }

    private async audit(
        type: SsoAuditEventType,
        row: Row,
        actor: SsoActor | undefined,
        changed?: readonly string[],
    ): Promise<void> {
        const event: SsoAuditEvent = {
            type,
            providerId: String(row.providerId),
            protocol: row.samlConfig ? 'saml' : 'oidc',
            organizationId: str(row.organizationId) ?? null,
            actorId: actor?.actorId ?? null,
            at: new Date().toISOString(),
            ...(changed === undefined ? {} : { changed }),
        };
        try {
            await this.deps.options.onAudit?.(event);
        } catch {
            /* Audit observers cannot fail the operation. */
        }
    }

    private async find(providerId: string): Promise<Row> {
        const store = await this.deps.store();
        const row = await store.adapter.findOne({ model: MODEL, where: [{ field: 'providerId', value: providerId }] });
        if (!row) {
            throw new SsoError('SSO_PROVIDER_NOT_FOUND', 'SSO provider not found.', 404);
        }

        return row;
    }

    private async pending(row: Row): Promise<boolean> {
        const store = await this.deps.store();
        const found = await store.internalAdapter.findVerificationValue(this.identifier(String(row.providerId)));

        return found !== null && (iso(found.expiresAt) ?? '') > new Date().toISOString();
    }

    private identifier(providerId: string): string {
        return `_${VERIFICATION_PREFIX}-${providerId}`;
    }

    private async summary(row: Row): Promise<SsoProviderSummary> {
        let domainVerification: SsoDomainVerification = 'not-required';
        if (this.verification) {
            domainVerification =
                row.domainVerified === true ? 'verified' : (await this.pending(row)) ? 'pending' : 'unverified';
        }
        const providerId = String(row.providerId);
        const base = {
            id: String(row.id),
            providerId,
            displayName: str(row.displayName) ?? providerId,
            enabled: row.enabled === true,
            organizationId: str(row.organizationId) ?? null,
            domains: domainsOf(row),
            domainVerification,
            createdAt: iso(row.createdAt) ?? new Date(0).toISOString(),
            updatedAt: iso(row.updatedAt) ?? new Date(0).toISOString(),
            createdBy: str(row.createdBy) ?? null,
            updatedBy: str(row.updatedBy) ?? null,
            lastValidatedAt: iso(row.lastValidatedAt),
            lastValidationStatus:
                row.lastValidationStatus === 'passed' || row.lastValidationStatus === 'failed'
                    ? (row.lastValidationStatus as 'passed' | 'failed')
                    : null,
            lastSuccessfulLoginAt: iso(row.lastSuccessfulLoginAt),
        };
        if (row.samlConfig) {
            const config = json(row.samlConfig);
            const idpMetadata = json(config.idpMetadata);
            let idpEntityId: string | null = null;
            try {
                idpEntityId = deriveSAMLIdentityProviderEntityID(config as never) ?? null;
            } catch {
                idpEntityId = null;
            }

            return {
                ...base,
                type: 'saml',
                idpEntityId,
                idpMetadataConfigured: Boolean(str(idpMetadata.metadata)),
                serviceProvider: {
                    acsUrl: this.acsUrl(providerId),
                    entityId:
                        str(json(config.spMetadata).entityID) ?? str(config.issuer) ?? this.metadataUrl(providerId),
                    metadataUrl: this.metadataUrl(providerId),
                    callbackUrl: this.acsUrl(providerId),
                },
                advanced: definedRecord({
                    entryPoint: str(config.entryPoint),
                    wantAssertionsSigned: config.wantAssertionsSigned as boolean | undefined,
                    identifierFormat: str(config.identifierFormat),
                    audience: str(config.audience),
                    idpInitiatedCallbackUrl: str(config.idpInitiatedCallbackUrl),
                    mapping: config.mapping as never,
                }),
            };
        }
        const config = json(row.oidcConfig);

        return {
            ...base,
            type: 'oidc',
            issuer: String(row.issuer),
            clientId: str(config.clientId) ?? '',
            clientSecretConfigured: Boolean(str(config.clientSecret)),
            redirectUri: this.redirectUri(providerId),
            advanced: definedRecord({
                scopes: config.scopes as string[] | undefined,
                pkce: config.pkce as boolean | undefined,
                discoveryEndpoint: str(config.discoveryEndpoint),
                authorizationEndpoint: str(config.authorizationEndpoint),
                tokenEndpoint: str(config.tokenEndpoint),
                jwksEndpoint: str(config.jwksEndpoint),
                userInfoEndpoint: str(config.userInfoEndpoint),
                tokenEndpointAuthentication: config.tokenEndpointAuthentication as never,
                mapping: config.mapping as never,
            }),
        };
    }

    async list(): Promise<readonly SsoProviderSummary[]> {
        const store = await this.deps.store();
        const rows = await store.adapter.findMany({ model: MODEL, limit: 1000 });

        return Promise.all(
            rows
                .sort((left, right) =>
                    String(left.displayName ?? left.providerId).localeCompare(
                        String(right.displayName ?? right.providerId),
                    ),
                )
                .map((row) => this.summary(row)),
        );
    }

    async get(providerId: string): Promise<SsoProviderSummary> {
        return this.summary(await this.find(providerId));
    }

    /** Enabled providers with their raw rows, for sign-in enforcement and discovery. */
    async enabledRows(): Promise<Row[]> {
        const store = await this.deps.store();

        return (await store.adapter.findMany({ model: MODEL, limit: 1000 })).filter((row) => row.enabled === true);
    }

    async isEnabled(providerId: string): Promise<boolean> {
        const store = await this.deps.store();
        const row = await store.adapter.findOne({ model: MODEL, where: [{ field: 'providerId', value: providerId }] });

        return row?.enabled === true;
    }

    private originsCache: { at: number; origins: string[] } | undefined;

    invalidateOrigins(): void {
        this.originsCache = undefined;
    }

    /** Origins the trusted-origin check must accept so Better Auth may talk to the enabled IdPs (cached briefly). */
    async idpOrigins(): Promise<string[]> {
        if (this.originsCache && Date.now() - this.originsCache.at < 10_000) {
            return this.originsCache.origins;
        }
        const origins = await this.computeIdpOrigins();
        this.originsCache = { at: Date.now(), origins };

        return origins;
    }

    private async computeIdpOrigins(): Promise<string[]> {
        const origins = new Set<string>();
        for (const row of await this.enabledRows()) {
            const oidc = json(row.oidcConfig);
            for (const value of [
                row.issuer,
                oidc.authorizationEndpoint,
                oidc.tokenEndpoint,
                oidc.jwksEndpoint,
                oidc.userInfoEndpoint,
                oidc.discoveryEndpoint,
            ]) {
                try {
                    if (typeof value === 'string') {
                        const origin = await assertIdpUrl(value, this.deps.options.trustedIdpOrigins);
                        origins.add(origin);
                    }
                } catch {
                    /* An unsafe origin is simply not trusted. */
                }
            }
        }

        return [...origins];
    }

    /** Whether an unsolicited (IdP-initiated) response may be accepted for this provider. */
    async allowsIdpInitiated(providerId: string): Promise<boolean> {
        if (!this.deps.options.allowIdpInitiated) {
            return false;
        }
        const store = await this.deps.store();
        const row = await store.adapter.findOne({ model: MODEL, where: [{ field: 'providerId', value: providerId }] });

        return row?.enabled === true && Boolean(str(json(row.samlConfig).idpInitiatedCallbackUrl));
    }

    async recordLogin(providerId: string): Promise<void> {
        const store = await this.deps.store();
        await store.adapter.update({
            model: MODEL,
            where: [{ field: 'providerId', value: providerId }],
            update: { lastSuccessfulLoginAt: new Date() },
        });
    }

    private async safeIdp(value: string, field: string): Promise<void> {
        try {
            await assertIdpUrl(value, this.deps.options.trustedIdpOrigins);
        } catch (error) {
            const reason = error instanceof Error ? error.message : '';
            throw new SsoError(
                'SSO_INVALID_INPUT',
                reason === 'invalid-url'
                    ? `${field} must be an absolute HTTP(S) URL.`
                    : `${field} must be an HTTPS URL on a public host; private hosts need an operator-declared trusted IdP origin.`,
                422,
            );
        }
    }

    private async buildOidc(
        input: {
            issuer: string;
            clientId: string;
            clientSecret?: string | undefined;
            advanced?: z.infer<typeof oidcAdvanced> | undefined;
        },
        validate: boolean,
    ): Promise<{ config: Row; diagnostics: SsoDiagnostic[] }> {
        const advanced = input.advanced ?? {};
        const diagnostics: SsoDiagnostic[] = [];
        await this.safeIdp(input.issuer, 'Issuer');
        for (const [name, value] of Object.entries({
            discoveryEndpoint: advanced.discoveryEndpoint,
            authorizationEndpoint: advanced.authorizationEndpoint,
            tokenEndpoint: advanced.tokenEndpoint,
            jwksEndpoint: advanced.jwksEndpoint,
            userInfoEndpoint: advanced.userInfoEndpoint,
        })) {
            if (value !== undefined) {
                await this.safeIdp(value, name);
            }
        }
        const issuer = input.issuer.replace(/\/+$/, '') || input.issuer;
        const config: Row = definedRecord({
            issuer,
            clientId: input.clientId,
            clientSecret: input.clientSecret,
            pkce: advanced.pkce ?? true,
            scopes: advanced.scopes,
            discoveryEndpoint: advanced.discoveryEndpoint ?? `${issuer}/.well-known/openid-configuration`,
            authorizationEndpoint: advanced.authorizationEndpoint,
            tokenEndpoint: advanced.tokenEndpoint,
            jwksEndpoint: advanced.jwksEndpoint,
            userInfoEndpoint: advanced.userInfoEndpoint,
            tokenEndpointAuthentication: advanced.tokenEndpointAuthentication ?? 'client_secret_basic',
            mapping: pluginMapping(advanced.mapping, 'oidc'),
        });
        if (!input.clientSecret) {
            diagnostics.push({
                code: 'OIDC_CLIENT_SECRET_MISSING',
                severity: 'error',
                message: 'No client secret is configured.',
            });
        }
        if (validate) {
            const origins = [
                ...this.deps.options.trustedIdpOrigins,
                ...(await Promise.all(
                    [
                        issuer,
                        ...[
                            advanced.discoveryEndpoint,
                            advanced.authorizationEndpoint,
                            advanced.tokenEndpoint,
                            advanced.jwksEndpoint,
                            advanced.userInfoEndpoint,
                        ].filter((value): value is string => value !== undefined),
                    ].map((value) => assertIdpUrl(value, this.deps.options.trustedIdpOrigins).catch(() => '')),
                )),
            ].filter(Boolean);
            try {
                const hydrated = await discoverOIDCConfig({
                    issuer,
                    existingConfig: {
                        discoveryEndpoint: config.discoveryEndpoint as string,
                        ...definedRecord({
                            authorizationEndpoint: advanced.authorizationEndpoint,
                            tokenEndpoint: advanced.tokenEndpoint,
                            jwksEndpoint: advanced.jwksEndpoint,
                            userInfoEndpoint: advanced.userInfoEndpoint,
                            tokenEndpointAuthentication: advanced.tokenEndpointAuthentication,
                        }),
                    },
                    isTrustedOrigin: (value: string) => {
                        try {
                            return origins.includes(new URL(value).origin);
                        } catch {
                            return false;
                        }
                    },
                });
                Object.assign(
                    config,
                    definedRecord({
                        authorizationEndpoint: hydrated.authorizationEndpoint,
                        tokenEndpoint: hydrated.tokenEndpoint,
                        jwksEndpoint: hydrated.jwksEndpoint,
                        userInfoEndpoint: hydrated.userInfoEndpoint,
                        discoveryEndpoint: hydrated.discoveryEndpoint,
                        tokenEndpointAuthentication:
                            advanced.tokenEndpointAuthentication ?? hydrated.tokenEndpointAuthentication,
                    }),
                );
            } catch (error) {
                diagnostics.push(this.discoveryDiagnostic(error));
            }
        }

        return { config, diagnostics };
    }

    /** Maps discovery failures to fixed text; the remote response is never echoed. */
    private discoveryDiagnostic(error: unknown): SsoDiagnostic {
        const code = error instanceof DiscoveryError ? error.code : '';
        if (code === 'issuer_mismatch') {
            return {
                code: 'OIDC_ISSUER_MISMATCH',
                severity: 'error',
                message: 'The discovery document issuer does not match the configured issuer.',
            };
        }
        if (code === 'discovery_incomplete') {
            return {
                code: 'OIDC_ENDPOINT_MISSING',
                severity: 'error',
                message: 'The discovery document is missing required endpoints.',
            };
        }
        if (code === 'discovery_untrusted_origin' || code === 'discovery_private_host') {
            return {
                code: 'CALLBACK_ORIGIN_UNTRUSTED',
                severity: 'error',
                message: 'An identity provider endpoint is on an untrusted origin.',
            };
        }

        return {
            code: 'OIDC_DISCOVERY_FAILED',
            severity: 'error',
            message: 'OIDC discovery failed; check the issuer and that the IdP is reachable.',
        };
    }

    private async buildSaml(
        providerId: string,
        input: {
            idpMetadata?: string | undefined;
            advanced?: z.infer<typeof samlAdvanced> | undefined;
        },
        previous?: Row,
    ): Promise<{ config: Row; diagnostics: SsoDiagnostic[] }> {
        const advanced = input.advanced ?? {};
        const diagnostics: SsoDiagnostic[] = [];
        const before = previous ? json(previous.samlConfig) : {};
        const metadata = input.idpMetadata?.trim() || str(json(before.idpMetadata).metadata);
        const entryPoint = advanced.entryPoint ?? str(before.entryPoint);
        const cert = advanced.cert ?? (before.cert as string | undefined);
        if (advanced.idpInitiatedCallbackUrl !== undefined && !/^\/(?!\/)/.test(advanced.idpInitiatedCallbackUrl)) {
            try {
                const target = new URL(advanced.idpInitiatedCallbackUrl);
                if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
                    throw new Error();
                }
                if (target.origin !== new URL(this.deps.baseURL).origin) {
                    diagnostics.push({
                        code: 'CALLBACK_ORIGIN_UNTRUSTED',
                        severity: 'warning',
                        message:
                            'The IdP-initiated destination is on another origin; it must be a configured trusted origin.',
                    });
                }
            } catch {
                throw new SsoError(
                    'SSO_INVALID_INPUT',
                    'The IdP-initiated destination must be a relative path or absolute HTTP(S) URL.',
                    422,
                );
            }
        }
        if (entryPoint !== undefined && entryPoint !== '') {
            // Only the browser is redirected here; the server never fetches it, so a syntax check is enough.
            try {
                const target = new URL(entryPoint);
                if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
                    throw new Error();
                }
            } catch {
                throw new SsoError('SSO_INVALID_INPUT', 'entryPoint must be an absolute HTTP(S) URL.', 422);
            }
        }
        const spEntityId = str(json(before.spMetadata).entityID) ?? this.metadataUrl(providerId);
        const config: Row = definedRecord({
            issuer: spEntityId,
            entryPoint: entryPoint ?? '',
            cert,
            audience: advanced.audience ?? str(before.audience),
            callbackUrl: this.acsUrl(providerId),
            idpInitiatedCallbackUrl: advanced.idpInitiatedCallbackUrl ?? str(before.idpInitiatedCallbackUrl),
            idpMetadata: metadata ? { metadata: metadata } : undefined,
            spMetadata: { entityID: spEntityId },
            wantAssertionsSigned:
                advanced.wantAssertionsSigned ?? (before.wantAssertionsSigned as boolean | undefined) ?? true,
            authnRequestsSigned: false,
            identifierFormat: advanced.identifierFormat ?? str(before.identifierFormat),
            mapping: pluginMapping(advanced.mapping, 'saml') ?? (before.mapping as Row | undefined),
        });
        if (!metadata && !(entryPoint && cert)) {
            diagnostics.push({
                code: 'SAML_IDP_VALUES_MISSING',
                severity: 'error',
                message: 'Provide IdP metadata XML, or an SSO URL and signing certificate.',
            });

            return { config, diagnostics };
        }
        let certificates: string[] = [];
        if (metadata) {
            try {
                deriveSAMLIdentityProviderEntityID({ idpMetadata: { metadata } } as never);
                certificates = metadataCertificates(metadata);
            } catch {
                diagnostics.push({
                    code: 'SAML_METADATA_INVALID',
                    severity: 'error',
                    message: 'The IdP metadata could not be parsed.',
                });
            }
        } else if (cert) {
            certificates = [cert];
        }
        if (!diagnostics.length && (certificates.length === 0 || certificateProblems(certificates))) {
            diagnostics.push({
                code: 'SAML_CERTIFICATE_INVALID',
                severity: 'error',
                message: 'The IdP signing certificate is missing, malformed or expired.',
            });
        }

        return { config, diagnostics };
    }

    async create(input: CreateSsoProviderInput, actor?: SsoActor): Promise<SsoProviderSummary> {
        const data = parse(CREATE, input);
        if (!SSO_PROVIDER_ID_PATTERN.test(data.providerId) || data.providerId.length > 48) {
            throw new SsoError(
                'SSO_INVALID_INPUT',
                'Provider IDs are 3-48 lowercase letters, digits and hyphens, starting with a letter.',
            );
        }
        if (RESERVED_PROVIDER_IDS.has(data.providerId)) {
            throw new SsoError('SSO_PROVIDER_ID_RESERVED', 'This provider ID is reserved.', 422);
        }
        const store = await this.deps.store();
        if (await store.adapter.findOne({ model: MODEL, where: [{ field: 'providerId', value: data.providerId }] })) {
            throw new SsoError('SSO_PROVIDER_EXISTS', 'An SSO provider with this ID already exists.', 409);
        }
        const domains = normalizeDomains(data.domains);
        const enabled = data.enabled ?? true;
        let issuer: string;
        let oidcConfig: Row | null = null;
        let samlConfig: Row | null = null;
        let diagnostics: SsoDiagnostic[];
        if (data.type === 'oidc') {
            if (!data.clientSecret) {
                throw new SsoError('SSO_INVALID_INPUT', 'A client secret is required.');
            }
            const built = await this.buildOidc(data, enabled);
            oidcConfig = built.config;
            diagnostics = built.diagnostics;
            issuer = String(built.config.issuer);
        } else {
            const built = await this.buildSaml(data.providerId, data);
            samlConfig = built.config;
            diagnostics = built.diagnostics;
            issuer = String(built.config.issuer);
        }
        const blocking = diagnostics.filter(
            (entry) =>
                entry.severity === 'error' &&
                (enabled || data.type === 'saml' || entry.code === 'OIDC_CLIENT_SECRET_MISSING'),
        );
        if (blocking.length) {
            throw new SsoError('SSO_INVALID_INPUT', blocking.map((entry) => entry.message).join(' '), 422);
        }
        const now = new Date();
        const row = await store.adapter.create({
            model: MODEL,
            data: definedRecord({
                issuer,
                oidcConfig: oidcConfig ? JSON.stringify(oidcConfig) : null,
                samlConfig: samlConfig ? JSON.stringify(samlConfig) : null,
                userId: actor?.actorId ?? 'system',
                providerId: data.providerId,
                organizationId: data.organizationId ?? null,
                domain: domains.join(','),
                domainVerified: false,
                displayName: data.displayName,
                enabled,
                createdBy: actor?.actorId ?? null,
                updatedBy: actor?.actorId ?? null,
                lastValidatedAt: enabled ? now : null,
                lastValidationStatus: enabled ? 'passed' : null,
                createdAt: now,
                updatedAt: now,
            }),
        });
        this.invalidateOrigins();
        await this.audit('created', row, actor);

        return this.summary(row);
    }

    async update(providerId: string, input: UpdateSsoProviderInput, actor?: SsoActor): Promise<SsoProviderSummary> {
        const data = parse(UPDATE, input);
        const row = await this.find(providerId);
        const isSaml = Boolean(row.samlConfig);
        const changed: string[] = [];
        const update: Row = { updatedAt: new Date(), updatedBy: actor?.actorId ?? null };
        if (data.displayName !== undefined) {
            update.displayName = data.displayName;
            changed.push('displayName');
        }
        if (data.organizationId !== undefined) {
            update.organizationId = data.organizationId;
            changed.push('organizationId');
        }
        if (data.domains !== undefined) {
            const domains = normalizeDomains(data.domains);
            if (domains.join(',') !== domainsOf(row).join(',')) {
                update.domain = domains.join(',');
                update.domainVerified = false;
                changed.push('domains');
            }
        }
        const willBeEnabled = data.enabled ?? row.enabled === true;
        if (isSaml) {
            if (data.issuer !== undefined || data.clientId !== undefined || data.clientSecret !== undefined) {
                throw new SsoError('SSO_INVALID_INPUT', 'OIDC settings cannot be set on a SAML provider.');
            }
            if (data.idpMetadata !== undefined || data.advanced !== undefined) {
                const built = await this.buildSaml(
                    providerId,
                    { idpMetadata: data.idpMetadata, advanced: data.advanced },
                    row,
                );
                const blocking = built.diagnostics.filter((entry) => entry.severity === 'error');
                if (blocking.length) {
                    throw new SsoError('SSO_INVALID_INPUT', blocking.map((entry) => entry.message).join(' '), 422);
                }
                update.samlConfig = JSON.stringify(built.config);
                update.issuer = String(built.config.issuer);
                changed.push('saml');
            }
        } else {
            if (data.idpMetadata !== undefined) {
                throw new SsoError('SSO_INVALID_INPUT', 'IdP metadata cannot be set on an OIDC provider.');
            }
            const previous = json(row.oidcConfig);
            if (
                data.issuer !== undefined ||
                data.clientId !== undefined ||
                data.clientSecret !== undefined ||
                data.advanced !== undefined
            ) {
                const advanced = {
                    ...definedRecord({
                        scopes: previous.scopes,
                        pkce: previous.pkce,
                        discoveryEndpoint: previous.discoveryEndpoint,
                        authorizationEndpoint: previous.authorizationEndpoint,
                        tokenEndpoint: previous.tokenEndpoint,
                        jwksEndpoint: previous.jwksEndpoint,
                        userInfoEndpoint: previous.userInfoEndpoint,
                        tokenEndpointAuthentication: previous.tokenEndpointAuthentication,
                        mapping: previous.mapping,
                    }),
                    ...(data.advanced ?? {}),
                } as z.infer<typeof oidcAdvanced>;
                // Changing the issuer invalidates endpoints discovered for the old one.
                if (data.issuer !== undefined && data.issuer !== row.issuer) {
                    for (const key of [
                        'discoveryEndpoint',
                        'authorizationEndpoint',
                        'tokenEndpoint',
                        'jwksEndpoint',
                        'userInfoEndpoint',
                    ] as const) {
                        if (data.advanced?.[key] === undefined) {
                            delete advanced[key];
                        }
                    }
                }
                const built = await this.buildOidc(
                    {
                        issuer: data.issuer ?? String(row.issuer),
                        clientId: data.clientId ?? String(previous.clientId ?? ''),
                        clientSecret: data.clientSecret ?? str(previous.clientSecret),
                        advanced,
                    },
                    willBeEnabled,
                );
                const blocking = built.diagnostics.filter(
                    (entry) =>
                        entry.severity === 'error' && (willBeEnabled || entry.code === 'OIDC_CLIENT_SECRET_MISSING'),
                );
                if (blocking.length) {
                    throw new SsoError('SSO_INVALID_INPUT', blocking.map((entry) => entry.message).join(' '), 422);
                }
                update.oidcConfig = JSON.stringify(built.config);
                update.issuer = String(built.config.issuer);
                changed.push(...(data.clientSecret === undefined ? [] : ['clientSecret']), 'oidc');
            }
        }
        const enabledChanged = data.enabled !== undefined && data.enabled !== (row.enabled === true);
        if (enabledChanged) {
            update.enabled = data.enabled;
        }
        const store = await this.deps.store();
        const saved = await store.adapter.update({
            model: MODEL,
            where: [{ field: 'providerId', value: providerId }],
            update,
        });
        if (!saved) {
            throw new SsoError('SSO_PROVIDER_NOT_FOUND', 'SSO provider not found.', 404);
        }
        this.invalidateOrigins();
        if (changed.includes('domains') && this.verification) {
            await store.internalAdapter.deleteVerificationByIdentifier(this.identifier(providerId));
            await this.audit('domain-verification-changed', saved, actor);
        }
        if (changed.length) {
            await this.audit('updated', saved, actor, changed);
        }
        if (enabledChanged) {
            await this.audit(data.enabled ? 'enabled' : 'disabled', saved, actor);
        }

        return this.summary(saved);
    }

    async setEnabled(providerId: string, enabled: boolean, actor?: SsoActor): Promise<SsoProviderSummary> {
        const row = await this.find(providerId);
        if (enabled && row.enabled !== true) {
            const result = await this.runTest(row);
            if (!result.valid) {
                throw new SsoError(
                    'SSO_INVALID_INPUT',
                    `Cannot enable a provider whose configuration is invalid: ${result.diagnostics
                        .filter((entry) => entry.severity === 'error')
                        .map((entry) => entry.message)
                        .join(' ')}`,
                    422,
                );
            }
        }
        if (row.enabled === enabled) {
            return this.summary(row);
        }

        return this.update(providerId, { enabled }, actor);
    }

    async delete(providerId: string, actor?: SsoActor): Promise<void> {
        const row = await this.find(providerId);
        const store = await this.deps.store();
        // Only configuration goes; users, their linked accounts and sessions are deliberately kept.
        await store.adapter.delete({ model: MODEL, where: [{ field: 'providerId', value: providerId }] });
        await store.internalAdapter.deleteVerificationByIdentifier(this.identifier(providerId));
        this.invalidateOrigins();
        await this.audit('deleted', row, actor);
    }

    private async runTest(row: Row): Promise<SsoTestResult> {
        const providerId = String(row.providerId);
        const diagnostics: SsoDiagnostic[] = [];
        let type: 'oidc' | 'saml';
        if (row.samlConfig) {
            type = 'saml';
            const config = json(row.samlConfig);
            const metadata = str(json(config.idpMetadata).metadata);
            const built = await this.buildSaml(
                providerId,
                {
                    ...(metadata === undefined ? {} : { idpMetadata: metadata }),
                    advanced: definedRecord({
                        entryPoint: str(config.entryPoint),
                        cert: typeof config.cert === 'string' ? config.cert : undefined,
                    }),
                },
                row,
            ).catch((): { diagnostics: SsoDiagnostic[] } => ({
                diagnostics: [
                    {
                        code: 'SAML_METADATA_INVALID',
                        severity: 'error',
                        message: 'The IdP metadata could not be parsed.',
                    },
                ],
            }));
            diagnostics.push(...built.diagnostics);
        } else {
            type = 'oidc';
            const config = json(row.oidcConfig);
            const built = await this.buildOidc(
                {
                    issuer: String(row.issuer),
                    clientId: String(config.clientId ?? ''),
                    clientSecret: str(config.clientSecret),
                    advanced: definedRecord({
                        discoveryEndpoint: str(config.discoveryEndpoint),
                        authorizationEndpoint: str(config.authorizationEndpoint),
                        tokenEndpoint: str(config.tokenEndpoint),
                        jwksEndpoint: str(config.jwksEndpoint),
                        userInfoEndpoint: str(config.userInfoEndpoint),
                    }),
                },
                true,
            ).catch((): { diagnostics: SsoDiagnostic[] } => ({
                diagnostics: [
                    {
                        code: 'CALLBACK_ORIGIN_UNTRUSTED',
                        severity: 'error',
                        message: 'An identity provider endpoint is on an untrusted origin.',
                    },
                ],
            }));
            diagnostics.push(...built.diagnostics);
        }
        if (this.verification && row.domainVerified !== true) {
            diagnostics.push({
                code: 'DOMAIN_UNVERIFIED',
                severity: 'warning',
                message: 'The provider domains are not verified, so sign-in stays blocked.',
            });
        }
        if (row.enabled !== true) {
            diagnostics.push({
                code: 'PROVIDER_DISABLED',
                severity: 'warning',
                message: 'The provider is disabled and rejects sign-ins.',
            });
        }

        return {
            providerId,
            type,
            valid: diagnostics.every((entry) => entry.severity !== 'error'),
            testedAt: new Date().toISOString(),
            diagnostics,
        };
    }

    async test(providerId: string, actor?: SsoActor): Promise<SsoTestResult> {
        const row = await this.find(providerId);
        const result = await this.runTest(row);
        const store = await this.deps.store();
        await store.adapter.update({
            model: MODEL,
            where: [{ field: 'providerId', value: providerId }],
            update: {
                lastValidatedAt: new Date(result.testedAt),
                lastValidationStatus: result.valid ? 'passed' : 'failed',
            },
        });
        await this.audit('test-attempted', row, actor);

        return result;
    }

    async discover(query: SsoDiscoveryQuery): Promise<SsoDiscoveryResult> {
        const rows = await this.enabledRows();
        const verifiedOnly = (row: Row) => !this.verification || row.domainVerified === true;
        let matches: Row[];
        if (query.providerId) {
            matches = rows.filter((row) => row.providerId === query.providerId);
        } else if (query.organizationSlug) {
            const organizationId = await this.deps.options.resolveOrganization?.(query.organizationSlug);
            matches = organizationId ? rows.filter((row) => row.organizationId === organizationId) : [];
        } else {
            const domain = (query.domain ?? query.email?.split('@').pop() ?? '').trim().toLowerCase();
            matches = domain ? rows.filter((row) => verifiedOnly(row) && domainsOf(row).includes(domain)) : [];
        }
        const choices: SsoDiscoveryChoice[] = matches.map((row) => ({
            providerId: String(row.providerId),
            displayName: str(row.displayName) ?? String(row.providerId),
            type: row.samlConfig ? 'saml' : 'oidc',
        }));
        const [only] = choices;
        if (!only) {
            return { status: 'none' };
        }

        return choices.length === 1 ? { status: 'match', provider: only } : { status: 'choice', providers: choices };
    }

    private async loadVerification(providerId: string): Promise<{ value: string; expiresAt: string } | null> {
        const store = await this.deps.store();
        const found = await store.internalAdapter.findVerificationValue(this.identifier(providerId));
        const expiresAt = found ? iso(found.expiresAt) : null;

        return found && expiresAt && expiresAt > new Date().toISOString() ? { value: found.value, expiresAt } : null;
    }

    async requestDomainVerification(providerId: string, actor?: SsoActor): Promise<SsoDomainVerificationInstructions> {
        const row = await this.find(providerId);
        if (!this.verification) {
            throw new SsoError('SSO_INVALID_INPUT', 'Domain verification is not enabled.', 409);
        }
        const domains = domainsOf(row);
        if (row.domainVerified === true) {
            return { providerId, status: 'verified', domains, recordName: null, recordValue: null, expiresAt: null };
        }
        let active = await this.loadVerification(providerId);
        if (!active) {
            const store = await this.deps.store();
            const value = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url');
            const expiresAt = new Date(Date.now() + 7 * 86_400_000);
            await store.internalAdapter.deleteVerificationByIdentifier(this.identifier(providerId));
            await store.internalAdapter.createVerificationValue({
                identifier: this.identifier(providerId),
                value,
                expiresAt,
            });
            active = { value, expiresAt: expiresAt.toISOString() };
            await this.audit('domain-verification-changed', row, actor);
        }

        return {
            providerId,
            status: 'pending',
            domains,
            recordName: this.identifier(providerId),
            recordValue: active.value,
            expiresAt: active.expiresAt,
        };
    }

    async verifyDomain(providerId: string, actor?: SsoActor): Promise<SsoProviderSummary> {
        const row = await this.find(providerId);
        if (!this.verification) {
            throw new SsoError('SSO_INVALID_INPUT', 'Domain verification is not enabled.', 409);
        }
        if (row.domainVerified === true) {
            return this.summary(row);
        }
        const active = await this.loadVerification(providerId);
        if (!active) {
            throw new SsoError('SSO_DOMAIN_VERIFICATION_FAILED', 'Request domain verification first.', 409);
        }
        const resolve = this.deps.options.domainVerification.resolveTxt ?? dnsResolveTxt;
        for (const domain of domainsOf(row)) {
            let records: string[] = [];
            try {
                records = (await resolve(`${this.identifier(providerId)}.${domain}`)).map((record) =>
                    record.join('').trim(),
                );
            } catch {
                records = [];
            }
            if (
                !records.some(
                    (record) => record === active.value || record === `${this.identifier(providerId)}=${active.value}`,
                )
            ) {
                throw new SsoError(
                    'SSO_DOMAIN_VERIFICATION_FAILED',
                    `Could not verify ownership of ${domain}; check the DNS TXT record.`,
                    422,
                );
            }
        }
        const store = await this.deps.store();
        const saved = await store.adapter.update({
            model: MODEL,
            where: [{ field: 'providerId', value: providerId }],
            update: { domainVerified: true, updatedAt: new Date(), updatedBy: actor?.actorId ?? null },
        });
        await store.internalAdapter.deleteVerificationByIdentifier(this.identifier(providerId));
        await this.audit('domain-verification-changed', saved ?? row, actor);

        return this.summary(saved ?? row);
    }
}
