import type { AdminResourceMetadata } from '@nestrum/admin';
import { z } from 'zod';

const FIELD_SCHEMA = z.object({
    name: z.string().min(1),
    label: z.string().min(1),
    kind: z.enum([
        'string',
        'integer',
        'number',
        'bigint',
        'boolean',
        'date',
        'date-string',
        'datetime-string',
        'temporal-instant',
        'temporal-datetime',
        'temporal-date',
        'temporal-time',
    ]),
    array: z.boolean(),
    nullable: z.boolean(),
    optional: z.boolean(),
    primaryKey: z.boolean(),
    hasCreateDefault: z.boolean(),
    hasUpdateDefault: z.boolean(),
    enumValues: z.array(z.string()),
    creatable: z.boolean(),
    updatable: z.boolean(),
    required: z.boolean(),
    readOnly: z.boolean(),
    widget: z
        .string()
        .regex(/^[A-Za-z][A-Za-z0-9_.-]*$/)
        .optional(),
});
export const ADMIN_METADATA_SCHEMA = z
    .array(
        z.object({
            identity: z.string().min(1),
            slug: z.string().regex(/^[A-Za-z0-9_-]+$/),
            model: z.string().min(1),
            label: z.string().min(1),
            primaryKey: z.string().min(1),
            listDisplay: z.array(z.string()),
            fields: z.array(FIELD_SCHEMA),
            actions: z.array(z.object({ name: z.string().min(1), label: z.string().min(1) })),
            capabilities: z.object({
                list: z.boolean(),
                retrieve: z.boolean(),
                create: z.boolean(),
                update: z.boolean(),
                delete: z.boolean(),
            }),
        }),
    )
    .superRefine((resources, context) => {
        if (
            new Set(resources.map((resource) => resource.slug)).size !== resources.length ||
            new Set(resources.map((resource) => resource.identity)).size !== resources.length
        ) {
            context.addIssue({ code: 'custom', message: 'Admin resource identities and paths must be unique.' });
        }
    });

export type AdminFetch = typeof globalThis.fetch;
export type TwoFactorReason = 'setup-required' | 'challenge-required';
export type AdminShellState =
    | { readonly status: 'ready'; readonly resources: readonly AdminResourceMetadata[] }
    | { readonly status: 'two-factor'; readonly reason: TwoFactorReason; readonly message: string }
    | { readonly status: 'sign-in' | 'denied' | 'error'; readonly message: string };

const TWO_FACTOR_ERROR_SCHEMA = z.object({
    error: z.object({
        code: z.literal('ADMIN_2FA_REQUIRED'),
        reason: z.enum(['setup-required', 'challenge-required']),
    }),
});

export class AdminMetadataError extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
        message: string,
        readonly reason?: TwoFactorReason,
    ) {
        super(message);
        this.name = 'AdminMetadataError';
    }
}

export class AdminMetadataClient {
    constructor(private readonly fetch: AdminFetch = globalThis.fetch) {}

    async resources(): Promise<readonly AdminResourceMetadata[]> {
        const response = await this.fetch('/__admin/resources', {
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { accept: 'application/json' },
        });
        if (response.status === 403) {
            const challenge = TWO_FACTOR_ERROR_SCHEMA.safeParse(await response.json().catch(() => null));
            if (challenge.success) {
                throw new AdminMetadataError(
                    403,
                    'ADMIN_2FA_REQUIRED',
                    'Two-factor verification is required.',
                    challenge.data.error.reason,
                );
            }
        }
        if (!response.ok) {
            throw new AdminMetadataError(
                response.status,
                'ADMIN_METADATA_REQUEST_FAILED',
                'Unable to load admin resources.',
            );
        }
        let input: unknown;
        try {
            input = await response.json();
        } catch {
            throw new AdminMetadataError(502, 'ADMIN_METADATA_INVALID', 'Invalid admin resource metadata.');
        }
        const result = ADMIN_METADATA_SCHEMA.safeParse(input);
        if (!result.success) {
            throw new AdminMetadataError(502, 'ADMIN_METADATA_INVALID', 'Invalid admin resource metadata.');
        }

        return result.data;
    }
}

export async function loadAdminState(fetch: AdminFetch): Promise<AdminShellState> {
    try {
        return { status: 'ready', resources: await new AdminMetadataClient(fetch).resources() };
    } catch (error) {
        if (error instanceof AdminMetadataError && error.status === 401) {
            return { status: 'sign-in', message: 'Sign in to open administration.' };
        }
        if (error instanceof AdminMetadataError && error.reason !== undefined) {
            return { status: 'two-factor', reason: error.reason, message: 'Two-factor verification is required.' };
        }
        if (error instanceof AdminMetadataError && error.status === 403) {
            return { status: 'denied', message: 'You do not have access to administration.' };
        }

        return { status: 'error', message: 'Administration is temporarily unavailable. Please try again.' };
    }
}
