import { AppError } from '#core/application/application.errors';

export type SsoProtocol = 'oidc' | 'saml';
export type SsoDomainVerification = 'verified' | 'unverified' | 'pending' | 'not-required';
export type SsoTokenEndpointAuthentication = 'client_secret_basic' | 'client_secret_post';

/** Attribute names read from the IdP's verified claims or assertion. Only these are mapped; nothing is inferred. */
export type SsoAttributeMapping = {
    readonly id?: string;
    readonly email?: string;
    readonly emailVerified?: string;
    readonly name?: string;
    readonly image?: string;
    readonly extraFields?: Readonly<Record<string, string>>;
};

export type SsoOidcAdvanced = {
    readonly scopes?: readonly string[];
    readonly pkce?: boolean;
    readonly discoveryEndpoint?: string;
    readonly authorizationEndpoint?: string;
    readonly tokenEndpoint?: string;
    readonly jwksEndpoint?: string;
    readonly userInfoEndpoint?: string;
    readonly tokenEndpointAuthentication?: SsoTokenEndpointAuthentication;
    readonly mapping?: SsoAttributeMapping;
};
export type SsoSamlAdvanced = {
    /** Manual IdP settings, used only when no metadata XML is supplied. */
    readonly entryPoint?: string;
    readonly cert?: string;
    readonly wantAssertionsSigned?: boolean;
    readonly identifierFormat?: string;
    readonly audience?: string;
    /** Trusted-origin absolute URL or same-origin relative path used after an IdP-initiated login. */
    readonly idpInitiatedCallbackUrl?: string;
    readonly mapping?: SsoAttributeMapping;
};

type SsoInputBase = {
    readonly providerId: string;
    readonly displayName: string;
    readonly organizationId?: string | null;
    readonly domains: readonly string[];
    readonly enabled?: boolean;
};
export type SsoOidcInput = SsoInputBase & {
    readonly type: 'oidc';
    readonly issuer: string;
    readonly clientId: string;
    /** Write-only. Required on create; omitted on update keeps the stored secret. */
    readonly clientSecret?: string;
    readonly advanced?: SsoOidcAdvanced;
};
export type SsoSamlInput = SsoInputBase & {
    readonly type: 'saml';
    /** IdP metadata XML. Preferred over manual settings. */
    readonly idpMetadata?: string;
    readonly advanced?: SsoSamlAdvanced;
};
export type CreateSsoProviderInput = SsoOidcInput | SsoSamlInput;
/** Updates never change `providerId` or `type`. Omitted fields keep their stored value. */
export type UpdateSsoProviderInput = {
    readonly displayName?: string;
    readonly organizationId?: string | null;
    readonly domains?: readonly string[];
    readonly enabled?: boolean;
    readonly issuer?: string;
    readonly clientId?: string;
    readonly clientSecret?: string;
    readonly idpMetadata?: string;
    readonly advanced?: SsoOidcAdvanced & SsoSamlAdvanced;
};

type SsoSummaryBase = {
    readonly id: string;
    readonly providerId: string;
    readonly displayName: string;
    readonly enabled: boolean;
    readonly organizationId: string | null;
    readonly domains: readonly string[];
    readonly domainVerification: SsoDomainVerification;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly createdBy: string | null;
    readonly updatedBy: string | null;
    readonly lastValidatedAt: string | null;
    readonly lastValidationStatus: 'passed' | 'failed' | null;
    readonly lastSuccessfulLoginAt: string | null;
};
export type SsoOidcSummary = SsoSummaryBase & {
    readonly type: 'oidc';
    readonly issuer: string;
    readonly clientId: string;
    /** The secret itself is never returned. */
    readonly clientSecretConfigured: boolean;
    readonly redirectUri: string;
    readonly advanced: SsoOidcAdvanced;
};
export type SsoSamlServiceProvider = {
    readonly acsUrl: string;
    readonly entityId: string;
    readonly metadataUrl: string;
    readonly callbackUrl: string;
};
export type SsoSamlSummary = SsoSummaryBase & {
    readonly type: 'saml';
    readonly idpEntityId: string | null;
    readonly idpMetadataConfigured: boolean;
    readonly serviceProvider: SsoSamlServiceProvider;
    readonly advanced: SsoSamlAdvanced;
};
export type SsoProviderSummary = SsoOidcSummary | SsoSamlSummary;

export type SsoDiagnosticCode =
    | 'OIDC_DISCOVERY_FAILED'
    | 'OIDC_ISSUER_MISMATCH'
    | 'OIDC_ENDPOINT_MISSING'
    | 'OIDC_CLIENT_SECRET_MISSING'
    | 'SAML_METADATA_INVALID'
    | 'SAML_CERTIFICATE_INVALID'
    | 'SAML_IDP_VALUES_MISSING'
    | 'DOMAIN_UNVERIFIED'
    | 'CALLBACK_ORIGIN_UNTRUSTED'
    | 'ORGANIZATION_MISSING'
    | 'PROVIDER_DISABLED';
export type SsoDiagnostic = {
    readonly code: SsoDiagnosticCode;
    readonly severity: 'error' | 'warning';
    /** Fixed text. It never contains tokens, secrets, assertions or raw remote responses. */
    readonly message: string;
};
export type SsoTestResult = {
    readonly providerId: string;
    readonly type: SsoProtocol;
    /** Configuration was well-formed. This is not a successful interactive login. */
    readonly valid: boolean;
    readonly testedAt: string;
    readonly diagnostics: readonly SsoDiagnostic[];
};

export type SsoDiscoveryQuery = {
    readonly email?: string;
    readonly domain?: string;
    readonly providerId?: string;
    readonly organizationSlug?: string;
};
export type SsoDiscoveryChoice = {
    readonly providerId: string;
    readonly displayName: string;
    readonly type: SsoProtocol;
};
export type SsoDiscoveryResult =
    | { readonly status: 'none' }
    | { readonly status: 'match'; readonly provider: SsoDiscoveryChoice }
    | { readonly status: 'choice'; readonly providers: readonly SsoDiscoveryChoice[] };

export type SsoDomainVerificationInstructions = {
    readonly providerId: string;
    readonly status: SsoDomainVerification;
    readonly domains: readonly string[];
    readonly recordName: string | null;
    readonly recordValue: string | null;
    readonly expiresAt: string | null;
};

export type SsoAuditEventType =
    | 'created'
    | 'updated'
    | 'enabled'
    | 'disabled'
    | 'deleted'
    | 'test-attempted'
    | 'domain-verification-changed';
export type SsoAuditEvent = {
    readonly type: SsoAuditEventType;
    readonly providerId: string;
    readonly protocol: SsoProtocol;
    readonly organizationId: string | null;
    readonly actorId: string | null;
    readonly at: string;
    /** Names of changed settings, never their values. */
    readonly changed?: readonly string[];
};

export type SsoActor = { readonly actorId?: string | null };

/** Nestrum's SSO provider registry. Better Auth's SSO plugin owns the protocols; this owns the provider lifecycle. */
export type SsoProviders = {
    list(): Promise<readonly SsoProviderSummary[]>;
    get(providerId: string): Promise<SsoProviderSummary>;
    create(input: CreateSsoProviderInput, actor?: SsoActor): Promise<SsoProviderSummary>;
    update(providerId: string, input: UpdateSsoProviderInput, actor?: SsoActor): Promise<SsoProviderSummary>;
    setEnabled(providerId: string, enabled: boolean, actor?: SsoActor): Promise<SsoProviderSummary>;
    /** Removes provider configuration only. Users, their linked accounts and sessions are left untouched. */
    delete(providerId: string, actor?: SsoActor): Promise<void>;
    /** Validates configuration (discovery, metadata, certificates). It never performs or implies a login. */
    test(providerId: string, actor?: SsoActor): Promise<SsoTestResult>;
    /** Resolves the enabled provider(s) for a sign-in attempt; several matches are returned as an explicit choice. */
    discover(query: SsoDiscoveryQuery): Promise<SsoDiscoveryResult>;
    requestDomainVerification(providerId: string, actor?: SsoActor): Promise<SsoDomainVerificationInstructions>;
    verifyDomain(providerId: string, actor?: SsoActor): Promise<SsoProviderSummary>;
};

export type SsoErrorCode =
    | 'SSO_NOT_ENABLED'
    | 'SSO_INVALID_INPUT'
    | 'SSO_PROVIDER_NOT_FOUND'
    | 'SSO_PROVIDER_EXISTS'
    | 'SSO_PROVIDER_ID_RESERVED'
    | 'SSO_PROVIDER_DISABLED'
    | 'SSO_DOMAIN_CONFLICT'
    | 'SSO_DOMAIN_VERIFICATION_FAILED'
    | 'SSO_DISCOVERY_AMBIGUOUS';

/** Safe, status-carrying failure. Messages are fixed text and never contain secrets or remote responses. */
export class SsoError extends AppError {
    constructor(
        code: SsoErrorCode,
        message: string,
        status: 400 | 404 | 409 | 422 | 502 = 400,
        options?: ErrorOptions,
    ) {
        super(code, message, status, options);
        this.name = 'SsoError';
    }
}

export const SSO_PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/;
export const SSO_ACTIONS = Object.freeze(['read', 'create', 'update', 'delete', 'enable', 'disable', 'test'] as const);
export type SsoAction = (typeof SSO_ACTIONS)[number];
