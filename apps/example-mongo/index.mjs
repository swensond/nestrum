export { default } from '@prisma/orm-mongo/runtime';

import { MongoFieldFilter } from '@prisma/orm-mongo/query-ast/execution';
import { MongoParamRef } from '@prisma/orm-mongo/value';

// Native AST filters need codec hints; plain ORM equality objects add these automatically.
export function bindMongoCollection(collection, metadata) {
    const codecs = new Map(metadata.fields.map((field) => [field.name, field.codec]));
    const encodeFilter = (filter) =>
        filter.rewrite({
            field: (field) => {
                const encode = (value) =>
                    value instanceof MongoParamRef
                        ? new MongoParamRef(value.value, {
                              codecId: codecs.get(field.field),
                              collection: metadata.name,
                              name: field.field,
                          })
                        : value;
                return new MongoFieldFilter(
                    field.field,
                    field.op,
                    Array.isArray(field.value) ? field.value.map(encode) : encode(field.value),
                );
            },
        });
    const wrap = (selected) => ({
        where: (filter) => wrap(selected.where(encodeFilter(filter))),
        limit: (value) => wrap(selected.limit(value)),
        orderBy: (value) => wrap(selected.orderBy(value)),
        all: () => selected.all(),
        create: (data) => selected.create(data),
        updateAndCount: (data) => selected.updateAndCount(data),
        deleteAndCount: () => selected.deleteAndCount(),
    });
    return { collection: wrap(collection), encodeFilter };
}
