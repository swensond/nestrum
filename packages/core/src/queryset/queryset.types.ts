export type QueryFilter<Value> = {
    readonly equals?: Value;
    readonly not?: Value;
    readonly in?: readonly Value[];
    readonly notIn?: readonly Value[];
    readonly lt?: Value;
    readonly lte?: Value;
    readonly gt?: Value;
    readonly gte?: Value;
    readonly contains?: string;
    readonly startsWith?: string;
    readonly endsWith?: string;
    readonly has?: Value extends readonly (infer Element)[] ? Element : never;
    readonly hasEvery?: Value extends readonly (infer Element)[] ? readonly Element[] : never;
    readonly hasSome?: Value extends readonly (infer Element)[] ? readonly Element[] : never;
    readonly isEmpty?: Value extends readonly unknown[] ? boolean : never;
};
export type QueryWhere<Row extends object> = { readonly [Key in keyof Row]?: Row[Key] | QueryFilter<Row[Key]> } & {
    readonly AND?: readonly QueryWhere<Row>[];
    readonly OR?: readonly QueryWhere<Row>[];
    readonly NOT?: QueryWhere<Row> | readonly QueryWhere<Row>[];
};
export type QueryOrder = { readonly field: string; readonly direction: 'asc' | 'desc' };
export type QuerySpec = { readonly filters: readonly object[]; readonly orderBy: readonly QueryOrder[]; readonly limit?: number };
export interface QueryBackend<Row extends object = object, Create extends object = object, Update extends object = object, Raw = unknown> {
    readonly raw: Raw;
    all(query: QuerySpec): Promise<readonly Row[]>;
    count(query: QuerySpec): Promise<number>;
    create(data: Create): Promise<Row>;
    update(query: QuerySpec, data: Update): Promise<number>;
    delete(query: QuerySpec): Promise<number>;
}
