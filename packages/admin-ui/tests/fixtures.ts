import type { AdminResourceMetadata } from '@nestrum/admin';

export function resource(model = 'Project', slug = 'projects'): AdminResourceMetadata {
    return {
        identity: `default.${model}`,
        model,
        database: 'default',
        slug,
        label: model,
        primaryKey: 'id',
        listDisplay: ['id'],
        actions: [],
        fields: [
            {
                name: 'id',
                label: 'Id',
                kind: 'string',
                array: false,
                nullable: false,
                optional: false,
                primaryKey: true,
                hasCreateDefault: true,
                hasUpdateDefault: false,
                enumValues: [],
                creatable: false,
                updatable: false,
                required: false,
                readOnly: true,
            },
        ],
        capabilities: { list: true, retrieve: true, create: true, update: true, delete: true },
    };
}
