import type { AdminResourceRegistration, Application } from '@nestrum/core';
import { AdminError } from '@nestrum/core';
import type { ScalarTransport } from '@nestrum/hono';
import { primaryKeyField, temporalAdapter } from '@nestrum/hono';
import type { AdminEntry } from '#admin/registry';

/** Validate every registration against compiled models before the runtime accepts traffic. */
export function resolveAdminEntries(
    registrations: readonly AdminResourceRegistration[],
    application: Application,
    slugs: ReadonlyMap<AdminResourceRegistration, string>,
    transport: ScalarTransport,
): readonly AdminEntry[] {
    return Object.freeze(
        registrations.map((registration) => {
            const { identity, configuration } = registration;
            if (!application.resources.has(identity)) {
                throw new AdminError(
                    'ADMIN_RESOURCE_UNKNOWN',
                    `Admin registration for ${identity} has no registered application resource.`,
                );
            }
            const resource = application.resources.get(identity);
            const editable = new Set(resource.metadata.fields.map((field) => field.name));
            for (const name of [...configuration.listDisplay, ...Object.keys(configuration.fields ?? {})]) {
                if (!editable.has(name)) {
                    throw new AdminError(
                        'ADMIN_FIELD_UNKNOWN',
                        `Admin configuration for ${identity} references unknown field ${name}.`,
                    );
                }
            }
            if (configuration.listDisplay.some((name) => configuration.fields?.[name]?.hidden)) {
                throw new AdminError('ADMIN_REGISTRATION_INVALID', 'Admin listDisplay cannot contain hidden fields.');
            }
            const primaryKey = primaryKeyField(resource).name;
            if (
                Object.hasOwn(resource.schemas.update.shape, primaryKey) ||
                resource.metadata.relations.some(
                    (relation) =>
                        Object.hasOwn(resource.schemas.create.shape, relation.name) ||
                        Object.hasOwn(resource.schemas.update.shape, relation.name),
                )
            ) {
                throw new AdminError(
                    'ADMIN_CONFIG_INVALID',
                    'Admin schemas cannot expose primary key updates or nested relation writes.',
                );
            }
            for (const field of resource.metadata.fields) {
                if (
                    field.kind.startsWith('temporal-') &&
                    (field.name === primaryKey ||
                        resource.schemas.create.shape[field.name] ||
                        resource.schemas.update.shape[field.name]) &&
                    !temporalAdapter(field, transport)
                ) {
                    throw new AdminError(
                        'ADMIN_CONFIG_INVALID',
                        `Admin input for ${identity}.${field.name} requires a Temporal adapter.`,
                    );
                }
            }
            const slug = slugs.get(registration);
            if (slug === undefined) {
                throw new AdminError('ADMIN_CONFIG_INVALID', `Admin registration for ${identity} lost its path.`);
            }

            return Object.freeze({
                identity: resource.identity,
                slug,
                resource,
                primaryKey,
                listDisplay: Object.freeze([...configuration.listDisplay]),
                fields: Object.freeze({ ...configuration.fields }),
                actions: Object.freeze({ ...configuration.actions }),
            });
        }),
    );
}
