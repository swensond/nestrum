import type {
    AdminFieldConfiguration,
    AdminResourceConfiguration,
    FieldMetadata,
    RegisteredResource,
} from '@nestrum/core';

export type AdminFieldMetadata = {
    readonly name: string;
    readonly kind: FieldMetadata['kind'];
    readonly label: string;
    readonly array: boolean;
    readonly nullable: boolean;
    readonly optional: boolean;
    readonly primaryKey: boolean;
    readonly hasCreateDefault: boolean;
    readonly hasUpdateDefault: boolean;
    readonly enumValues: readonly string[];
    readonly creatable: boolean;
    readonly updatable: boolean;
    readonly required: boolean;
    readonly readOnly: boolean;
};

export type AdminActionMetadata = {
    readonly name: string;
    readonly label: string;
};

export type AdminResourceMetadata = {
    readonly identity: string;
    readonly slug: string;
    readonly model: string;
    readonly database: string;
    readonly label: string;
    readonly primaryKey: string;
    readonly listDisplay: readonly string[];
    readonly fields: readonly AdminFieldMetadata[];
    readonly actions: readonly AdminActionMetadata[];
    readonly capabilities: {
        readonly list: boolean;
        readonly retrieve: boolean;
        readonly create: boolean;
        readonly update: boolean;
        readonly delete: boolean;
    };
};

/** `ownerId` becomes `Owner id` until a registration supplies an explicit label. */
function humanize(name: string): string {
    const words = name
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replaceAll('_', ' ')
        .replaceAll('-', ' ')
        .toLowerCase()
        .trim();
    return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : name;
}

function field(
    resource: RegisteredResource,
    metadata: FieldMetadata,
    configuration: AdminFieldConfiguration | undefined,
): AdminFieldMetadata {
    const create = resource.schemas.create.shape[metadata.name];
    const update = resource.schemas.update.shape[metadata.name];
    const creatable = create !== undefined && configuration?.readOnly !== true;
    const updatable = update !== undefined && configuration?.readOnly !== true;
    return Object.freeze({
        name: metadata.name,
        kind: metadata.kind,
        label: configuration?.label ?? humanize(metadata.name),
        array: metadata.array,
        nullable: metadata.nullable,
        optional: metadata.optional,
        primaryKey: metadata.primaryKey,
        hasCreateDefault: metadata.hasCreateDefault,
        hasUpdateDefault: metadata.hasUpdateDefault,
        enumValues: Object.freeze([...(metadata.enumValues ?? [])]),
        creatable,
        updatable,
        required: creatable && !create.isOptional(),
        readOnly: configuration?.readOnly === true || (!creatable && !updatable),
    });
}

export function resourceMetadata(
    resource: RegisteredResource,
    slug: string,
    primaryKey: string,
    configuration: AdminResourceConfiguration,
): Omit<AdminResourceMetadata, 'capabilities'> {
    const fields = resource.metadata.fields
        .filter((candidate) => configuration.fields?.[candidate.name]?.hidden !== true)
        .map((candidate) => field(resource, candidate, configuration.fields?.[candidate.name]));

    return Object.freeze({
        identity: resource.identity,
        slug,
        model: resource.model,
        database: resource.database,
        label: humanize(resource.model),
        primaryKey,
        listDisplay: Object.freeze([...configuration.listDisplay]),
        fields: Object.freeze(fields),
        actions: Object.freeze(
            Object.entries(configuration.actions ?? {}).map(([name, options]) =>
                Object.freeze({ name, label: options?.label ?? humanize(name) }),
            ),
        ),
    });
}
