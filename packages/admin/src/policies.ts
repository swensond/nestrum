import type { PolicyDefinition } from '@nestrum/core';
import { allow, deny } from '@nestrum/core';
import { ADMIN_ACCESS_ACTION, ADMIN_ACCESS_IDENTITY } from './access.js';

/** Capability identity and action for managing which users are staff. */
export const ADMIN_USERS_IDENTITY = 'admin.users';
export const ADMIN_USERS_ACTION = 'manage';

/** Capability identity for API-key management; actions are `read`, `create`, `revoke` and `rotate`. */
export const API_KEY_IDENTITY = 'api-key';
export const API_KEY_ACTIONS = Object.freeze(['read', 'create', 'revoke', 'rotate'] as const);
export type ApiKeyAction = (typeof API_KEY_ACTIONS)[number];

/** Capability identity for enterprise SSO provider management; one action per operation. */
export const SSO_IDENTITY = 'sso';
export const SSO_ACTIONS = Object.freeze(['read', 'create', 'update', 'delete', 'enable', 'disable', 'test'] as const);
export type SsoAction = (typeof SSO_ACTIONS)[number];

/** Capability identity for feature-flag management; `read` covers listing and explanations, `manage` writes overrides. */
export const FEATURE_IDENTITY = 'features';
export const FEATURE_ACTIONS = Object.freeze(['read', 'manage'] as const);
export type FeatureAction = (typeof FEATURE_ACTIONS)[number];

/**
 * The standard role-based policies for Nestrum's Better Auth roles: `staff` and `admin` may enter administration, and
 * only `admin` may manage users, API keys, SSO providers and feature overrides (`staff` may read features). Applications include these in `defineApplication({ policies })` and may add their own
 * resource policies; supplying different `admin.access`/`admin.users` policies replaces this behavior entirely.
 */
export function roleBasedAdminPolicies(): PolicyDefinition[] {
    return [
        {
            resource: ADMIN_ACCESS_IDENTITY,
            actions: {
                [ADMIN_ACCESS_ACTION]: {
                    authorize: ({ subject }) =>
                        subject.role === 'staff' || subject.role === 'admin' ? allow() : deny('NOT_STAFF'),
                },
            },
        },
        {
            resource: ADMIN_USERS_IDENTITY,
            actions: {
                [ADMIN_USERS_ACTION]: {
                    authorize: ({ subject }) => (subject.role === 'admin' ? allow() : deny('NOT_ADMIN')),
                },
            },
        },
        {
            resource: API_KEY_IDENTITY,
            actions: Object.fromEntries(
                API_KEY_ACTIONS.map((action) => [
                    action,
                    { authorize: ({ subject }) => (subject.role === 'admin' ? allow() : deny('NOT_ADMIN')) },
                ]),
            ),
        },
        {
            resource: SSO_IDENTITY,
            actions: Object.fromEntries(
                SSO_ACTIONS.map((action) => [
                    action,
                    { authorize: ({ subject }) => (subject.role === 'admin' ? allow() : deny('NOT_ADMIN')) },
                ]),
            ),
        },
        {
            resource: FEATURE_IDENTITY,
            actions: {
                read: {
                    authorize: ({ subject }) =>
                        subject.role === 'staff' || subject.role === 'admin' ? allow() : deny('NOT_STAFF'),
                },
                manage: { authorize: ({ subject }) => (subject.role === 'admin' ? allow() : deny('NOT_ADMIN')) },
            },
        },
    ];
}
