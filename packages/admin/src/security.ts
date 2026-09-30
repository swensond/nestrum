import type { AdminTwoFactorPolicy } from '@nestrum/core';
import { AdminError } from '@nestrum/core';

export const DEFAULT_ASSURANCE_TTL_SECONDS = 43_200;
export const MIN_ASSURANCE_TTL_SECONDS = 60;
export const MAX_ASSURANCE_TTL_SECONDS = 2_592_000;

export type AdminSecurityOptions = {
    readonly twoFactor?: {
        /** Require a second factor for admin UI and API access. Defaults to true. */
        readonly required?: boolean;
        /** Lifetime of a successful challenge, independent of the login session. Defaults to 43200 (12 hours). */
        readonly assuranceTtlSeconds?: number;
    };
};

function record(value: unknown, label: string): Record<string, unknown> {
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)
    ) {
        throw new AdminError('ADMIN_CONFIG_INVALID', `Admin ${label} must be an object.`);
    }

    return value as Record<string, unknown>;
}

/** Two-factor is required unless explicitly disabled; the TTL is validated even when 2FA is disabled. */
export function resolveTwoFactorPolicy(security?: AdminSecurityOptions): AdminTwoFactorPolicy {
    if (security === undefined) {
        return Object.freeze({ required: true, assuranceTtlSeconds: DEFAULT_ASSURANCE_TTL_SECONDS });
    }
    const options = record(security, 'security options');
    for (const name of Object.keys(options)) {
        if (name !== 'twoFactor') {
            throw new AdminError('ADMIN_CONFIG_INVALID', `Unknown admin security option ${name}.`);
        }
    }
    const twoFactor = options.twoFactor === undefined ? {} : record(options.twoFactor, 'twoFactor options');
    for (const name of Object.keys(twoFactor)) {
        if (!['required', 'assuranceTtlSeconds'].includes(name)) {
            throw new AdminError('ADMIN_CONFIG_INVALID', `Unknown admin twoFactor option ${name}.`);
        }
    }
    const { required = true, assuranceTtlSeconds = DEFAULT_ASSURANCE_TTL_SECONDS } = twoFactor;
    if (typeof required !== 'boolean') {
        throw new AdminError('ADMIN_CONFIG_INVALID', 'Admin twoFactor.required must be a boolean.');
    }
    if (
        typeof assuranceTtlSeconds !== 'number' ||
        !Number.isInteger(assuranceTtlSeconds) ||
        assuranceTtlSeconds < MIN_ASSURANCE_TTL_SECONDS ||
        assuranceTtlSeconds > MAX_ASSURANCE_TTL_SECONDS
    ) {
        throw new AdminError(
            'ADMIN_CONFIG_INVALID',
            `Admin twoFactor.assuranceTtlSeconds must be an integer from ${MIN_ASSURANCE_TTL_SECONDS} to ${MAX_ASSURANCE_TTL_SECONDS}.`,
        );
    }

    return Object.freeze({ required, assuranceTtlSeconds });
}
