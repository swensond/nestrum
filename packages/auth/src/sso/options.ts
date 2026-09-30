import type { SSOOptions } from '@better-auth/sso';
import type { SsoAuditEvent } from '@nestrum/core';
import { AppError } from '@nestrum/core';

type ProvisioningCallbacks = Pick<
    SSOOptions,
    'provisionUser' | 'provisionUserOnEveryLogin' | 'organizationProvisioning' | 'resolveUser' | 'trustEmailVerified'
>;

/** Enterprise SSO settings under `defineAuth({ sso })`. SSO is off unless `enabled` is true. */
export type SsoConfig = {
    readonly enabled: boolean;
    /** Origins of identity providers on private or loopback networks. Public IdPs need no entry. */
    readonly trustedIdpOrigins?: readonly string[];
    /** Verify provider domains by DNS TXT before trusting them for sign-in routing and account linking. */
    readonly domainVerification?: {
        readonly enabled?: boolean;
        /** Overrides DNS TXT resolution, mainly for tests. */
        readonly resolveTxt?: (name: string) => Promise<readonly (readonly string[])[]>;
    };
    /** Better Auth provisioning, exposed unchanged. IdP attributes still never become Nestrum authorization. */
    readonly provisioning?: ProvisioningCallbacks & {
        /** When true, an SSO login can only sign in existing users. Defaults to false. */
        readonly disableImplicitSignUp?: boolean;
    };
    /**
     * SAML IdP-initiated sign-in (unsolicited responses) is off unless enabled here, and then works only for providers
     * that also configure an `idpInitiatedCallbackUrl`.
     */
    readonly saml?: { readonly allowIdpInitiated?: boolean };
    /** Maps an organization slug to the application's organization id for slug-based login discovery. */
    readonly resolveOrganization?: (slug: string) => Promise<string | null> | string | null;
    /** Receives one event per provider configuration change. Failures never fail the operation. */
    readonly onAudit?: (event: SsoAuditEvent) => void | Promise<void>;
};

export type ResolvedSsoOptions = {
    readonly trustedIdpOrigins: readonly string[];
    readonly domainVerification: {
        readonly enabled: boolean;
        readonly resolveTxt?: (name: string) => Promise<readonly (readonly string[])[]>;
    };
    readonly provisioning: NonNullable<SsoConfig['provisioning']>;
    readonly allowIdpInitiated: boolean;
    readonly resolveOrganization?: SsoConfig['resolveOrganization'];
    readonly onAudit?: SsoConfig['onAudit'];
};

const KNOWN_KEYS = [
    'enabled',
    'trustedIdpOrigins',
    'domainVerification',
    'provisioning',
    'saml',
    'resolveOrganization',
    'onAudit',
];

function originOf(value: unknown): string {
    try {
        const url = new URL(String(value));
        if (
            !['http:', 'https:'].includes(url.protocol) ||
            url.username ||
            url.password ||
            url.origin !== String(value).replace(/\/$/, '')
        ) {
            throw new Error();
        }

        return url.origin;
    } catch {
        throw new AppError('AUTH_CONFIG_INVALID', 'SSO trustedIdpOrigins must be absolute HTTP(S) origins.');
    }
}

/** `undefined` when SSO is off; otherwise validated options. */
export function resolveSsoOptions(input: SsoConfig | undefined): ResolvedSsoOptions | undefined {
    if (input === undefined) {
        return undefined;
    }
    if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.enabled !== 'boolean') {
        throw new AppError('AUTH_CONFIG_INVALID', 'sso must be an options object with a boolean enabled flag.');
    }
    const unknown = Object.keys(input).find((key) => !KNOWN_KEYS.includes(key));
    if (unknown !== undefined) {
        throw new AppError('AUTH_CONFIG_INVALID', `Unknown SSO option ${unknown}.`);
    }
    if (!input.enabled) {
        return undefined;
    }
    if (input.trustedIdpOrigins !== undefined && !Array.isArray(input.trustedIdpOrigins)) {
        throw new AppError('AUTH_CONFIG_INVALID', 'SSO trustedIdpOrigins must be an array.');
    }
    for (const callback of [input.resolveOrganization, input.onAudit, input.domainVerification?.resolveTxt]) {
        if (callback !== undefined && typeof callback !== 'function') {
            throw new AppError('AUTH_CONFIG_INVALID', 'SSO callbacks must be functions.');
        }
    }
    const provisioning = input.provisioning ?? {};
    if (provisioning.disableImplicitSignUp !== undefined && typeof provisioning.disableImplicitSignUp !== 'boolean') {
        throw new AppError('AUTH_CONFIG_INVALID', 'SSO disableImplicitSignUp must be a boolean.');
    }

    return Object.freeze({
        trustedIdpOrigins: Object.freeze((input.trustedIdpOrigins ?? []).map(originOf)),
        domainVerification: Object.freeze({
            enabled: input.domainVerification?.enabled === true,
            ...(input.domainVerification?.resolveTxt === undefined
                ? {}
                : { resolveTxt: input.domainVerification.resolveTxt }),
        }),
        provisioning: Object.freeze({ ...provisioning }),
        allowIdpInitiated: input.saml?.allowIdpInitiated === true,
        ...(input.resolveOrganization === undefined ? {} : { resolveOrganization: input.resolveOrganization }),
        ...(input.onAudit === undefined ? {} : { onAudit: input.onAudit }),
    });
}
