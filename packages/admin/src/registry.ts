import type {
    AdminActionConfiguration,
    AdminFieldConfiguration,
    AdminResourceConfiguration,
    AdminResourceRegistration,
    RegisteredResource,
    ResourceConfig,
} from '@nestrum/core';
import { AdminError, modelIdentity, resourceSlug } from '@nestrum/core';
import type { ScalarTransport } from '@nestrum/hono';

export type AdminOptions = ScalarTransport & {
    /** Additional browser origins allowed to call the admin API. Same-origin is always allowed. */
    readonly allowedOrigins?: readonly string[];
};

export type AdminEntry = {
    readonly identity: RegisteredResource['identity'];
    readonly slug: string;
    readonly resource: RegisteredResource;
    readonly primaryKey: string;
    readonly listDisplay: readonly string[];
    readonly fields: Readonly<Record<string, AdminFieldConfiguration>>;
    readonly actions: Readonly<Record<string, AdminActionConfiguration>>;
};

export type AdminRegistryState = {
    readonly registrations: readonly AdminResourceRegistration[];
    readonly slugs: ReadonlyMap<AdminResourceRegistration, string>;
};

const BUILTIN_ACTIONS: readonly string[] = ['list', 'retrieve', 'create', 'update', 'delete'];

function extensionName(value: string, subject: string): string {
    if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(value)) {
        throw new AdminError('ADMIN_REGISTRATION_INVALID', `Admin ${subject} names must be safe identifier segments.`);
    }

    return value;
}

function origin(value: string): string {
    try {
        const url = new URL(value);
        if (
            !['http:', 'https:'].includes(url.protocol) ||
            url.username ||
            url.password ||
            url.origin !== value.replace(/\/$/, '')
        ) {
            throw new Error();
        }

        return url.origin;
    } catch {
        throw new AdminError('ADMIN_CONFIG_INVALID', 'Admin allowed origins must be absolute HTTP(S) origins.');
    }
}

function label(value: string | undefined, subject: string): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'string' || !value.trim() || value.trim() !== value) {
        throw new AdminError('ADMIN_REGISTRATION_INVALID', `Admin ${subject} labels must be nonempty and trimmed.`);
    }

    return value;
}

function key(value: string, subject: string): string {
    if (typeof value !== 'string' || !value.trim() || value.trim() !== value) {
        throw new AdminError('ADMIN_REGISTRATION_INVALID', `Admin ${subject} names must be nonempty and trimmed.`);
    }

    return value;
}

function configuration(identity: string, input: AdminResourceConfiguration): AdminResourceConfiguration {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new AdminError('ADMIN_REGISTRATION_INVALID', `Admin configuration for ${identity} must be an object.`);
    }
    if (
        !Array.isArray(input.listDisplay) ||
        input.listDisplay.length === 0 ||
        input.listDisplay.some((field) => typeof field !== 'string' || !field.trim() || field.trim() !== field)
    ) {
        throw new AdminError(
            'ADMIN_REGISTRATION_INVALID',
            `Admin ${identity} requires a nonempty listDisplay array of field names.`,
        );
    }
    if (new Set(input.listDisplay).size !== input.listDisplay.length) {
        throw new AdminError('ADMIN_REGISTRATION_INVALID', `Admin ${identity} listDisplay repeats a field.`);
    }
    for (const value of [input.fields, input.actions]) {
        if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) {
            throw new AdminError(
                'ADMIN_REGISTRATION_INVALID',
                'Admin fields and actions must be configuration records.',
            );
        }
    }
    const fields: Record<string, AdminFieldConfiguration> = Object.create(null) as Record<
        string,
        AdminFieldConfiguration
    >;
    for (const [name, options] of Object.entries(input.fields ?? {})) {
        if (
            !options ||
            typeof options !== 'object' ||
            Array.isArray(options) ||
            (options.hidden !== undefined && typeof options.hidden !== 'boolean') ||
            (options.readOnly !== undefined && typeof options.readOnly !== 'boolean')
        ) {
            throw new AdminError(
                'ADMIN_REGISTRATION_INVALID',
                `Invalid admin field configuration for ${identity}.${String(name)}.`,
            );
        }
        const configured = label(options.label, `field ${String(name)}`);
        fields[key(name, 'field')] = Object.freeze({
            ...(configured === undefined ? {} : { label: configured }),
            ...(options.hidden === undefined ? {} : { hidden: options.hidden }),
            ...(options.readOnly === undefined ? {} : { readOnly: options.readOnly }),
            ...(options.widget === undefined ? {} : { widget: extensionName(options.widget, 'widget') }),
        });
    }
    const actions: Record<string, AdminActionConfiguration> = Object.create(null) as Record<
        string,
        AdminActionConfiguration
    >;
    for (const [name, options] of Object.entries(input.actions ?? {})) {
        if (!options || typeof options !== 'object' || Array.isArray(options)) {
            throw new AdminError(
                'ADMIN_REGISTRATION_INVALID',
                `Invalid admin action configuration for ${identity}.${String(name)}.`,
            );
        }
        const action = extensionName(name, 'action');
        if (
            (options.handler !== undefined && typeof options.handler !== 'function') ||
            (options.input !== undefined && (!options.input || typeof options.input.parseAsync !== 'function'))
        ) {
            throw new AdminError(
                'ADMIN_REGISTRATION_INVALID',
                `Admin action ${action} requires a callable handler and a Zod input schema.`,
            );
        }
        if (BUILTIN_ACTIONS.includes(action)) {
            throw new AdminError(
                'ADMIN_ACTION_DUPLICATE',
                `Admin action ${action} on ${identity} conflicts with a built-in operation.`,
            );
        }
        const configured = label(options.label, `action ${action}`);
        actions[action] = Object.freeze({
            ...(configured === undefined ? {} : { label: configured }),
            ...(options.input === undefined ? {} : { input: options.input }),
            ...(options.handler === undefined ? {} : { handler: options.handler }),
        });
    }

    return Object.freeze({
        listDisplay: Object.freeze([...input.listDisplay]),
        ...(input.fields === undefined ? {} : { fields: Object.freeze(fields) }),
        ...(input.actions === undefined ? {} : { actions: Object.freeze(actions) }),
    });
}

/** Mutable registration order is owned by the application; the runtime resolves it once at startup. */
export class AdminRegistry {
    private readonly registrations: AdminResourceRegistration[] = [];
    private readonly slugs = new Map<AdminResourceRegistration, string>();
    private readonly allowedOrigins: readonly string[];
    private sealed = false;

    constructor(options: AdminOptions = {}) {
        if (options.allowedOrigins !== undefined && !Array.isArray(options.allowedOrigins)) {
            throw new AdminError('ADMIN_CONFIG_INVALID', 'Admin allowed origins must be an array.');
        }
        this.allowedOrigins = Object.freeze(
            (options.allowedOrigins ?? []).map((value) => {
                if (typeof value !== 'string') {
                    throw new AdminError('ADMIN_CONFIG_INVALID', 'Admin allowed origins must be strings.');
                }

                return origin(value);
            }),
        );
    }

    get origins(): readonly string[] {
        return this.allowedOrigins;
    }

    get state(): AdminRegistryState {
        return Object.freeze({
            registrations: Object.freeze([...this.registrations]),
            slugs: new Map(this.slugs),
        });
    }

    register(resource: ResourceConfig, input: AdminResourceConfiguration): this {
        if (this.sealed) {
            throw new AdminError('ADMIN_REGISTRATION_INVALID', 'Admin registration is closed after initialization.');
        }
        if (
            !resource ||
            typeof resource !== 'object' ||
            Array.isArray(resource) ||
            typeof resource.model !== 'string'
        ) {
            throw new AdminError('ADMIN_REGISTRATION_INVALID', 'Admin registration requires a resource definition.');
        }
        let identity: string;
        let slug: string;
        try {
            identity = modelIdentity(resource.model, resource.database ?? 'default');
            slug = `${resource.database && resource.database !== 'default' ? `${resource.database}--` : ''}${resourceSlug(resource.model)}`;
        } catch (cause) {
            throw new AdminError(
                'ADMIN_REGISTRATION_INVALID',
                'Admin resource names must be valid identifier segments.',
                { cause },
            );
        }
        if (this.registrations.some((entry) => entry.identity === identity)) {
            throw new AdminError('ADMIN_RESOURCE_DUPLICATE', `Resource ${identity} is registered for admin twice.`);
        }
        if (slug === 'resources' || [...this.slugs.values()].includes(slug)) {
            throw new AdminError('ADMIN_ROUTE_CONFLICT', `Admin resource path /${slug} is used more than once.`);
        }
        const registration: AdminResourceRegistration = Object.freeze({
            resource: Object.freeze({ ...resource }),
            identity,
            configuration: configuration(identity, input),
        });
        this.registrations.push(registration);
        this.slugs.set(registration, slug);

        return this;
    }

    seal(): void {
        this.sealed = true;
    }
}
