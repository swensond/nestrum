import type { FeatureRule, FeatureRuleScope, FeatureStore, PrismaProvider, QueryBackend } from '@nestrum/core';
import { AppError, FEATURE_RULE_SCOPES } from '@nestrum/core';

type Row = Record<string, unknown>;
type Input = Parameters<FeatureStore['upsert']>[0];

function where(flag: string, scope: FeatureRuleScope, target: string) {
    return {
        filters: [
            {
                AND: [{ flag: { equals: flag } }, { scope: { equals: scope } }, { target: { equals: target } }],
            },
        ],
        orderBy: [],
    };
}

function toRule(row: Row): FeatureRule {
    const scope = row.scope;
    const updated = row.updatedAt instanceof Date ? row.updatedAt : new Date(String(row.updatedAt));
    const id =
        typeof row.id === 'string' ? row.id : row.id === undefined || row.id === null ? undefined : String(row.id);
    if (
        id === undefined ||
        typeof row.flag !== 'string' ||
        typeof row.target !== 'string' ||
        typeof row.enabled !== 'boolean' ||
        !(FEATURE_RULE_SCOPES as readonly unknown[]).includes(scope)
    ) {
        throw new AppError('FEATURE_STORAGE_INVALID', 'A stored feature override is malformed.');
    }

    return Object.freeze({
        id,
        flag: row.flag,
        scope: scope as FeatureRuleScope,
        target: row.target,
        enabled: row.enabled,
        percentage: typeof row.percentage === 'number' ? row.percentage : null,
        updatedBy: typeof row.updatedBy === 'string' ? row.updatedBy : null,
        updatedAt: Number.isNaN(updated.getTime()) ? new Date(0).toISOString() : updated.toISOString(),
    });
}

/** Feature overrides on Nestrum's `FeatureOverride` model, through the same Prisma query backend resources use. */
export function createPrismaFeatureStore(backend: QueryBackend, provider: PrismaProvider): FeatureStore {
    // MongoDB `_id` is an ObjectId, written as its 24-character hex string like every other Nestrum Mongo model.
    const newId = () =>
        provider === 'mongodb'
            ? Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => byte.toString(16).padStart(2, '0')).join(
                  '',
              )
            : crypto.randomUUID();
    const stamp = () => (provider === 'mongodb' ? new Date() : new Date().toISOString());
    const find = async (flag: string, scope: FeatureRuleScope, target: string): Promise<Row | undefined> =>
        (await backend.all({ ...where(flag, scope, target), limit: 1 }))[0] as Row | undefined;
    const write = async (existing: Row | undefined, input: Input): Promise<Row | undefined> => {
        const data = {
            enabled: input.enabled,
            percentage: input.percentage,
            updatedBy: input.updatedBy,
            updatedAt: stamp(),
        };
        if (existing) {
            await backend.update(where(input.flag, input.scope, input.target), data);

            return find(input.flag, input.scope, input.target);
        }

        return (await backend.create({
            id: newId(),
            flag: input.flag,
            scope: input.scope,
            target: input.target,
            createdAt: stamp(),
            ...data,
        })) as Row;
    };

    return {
        async list(flag) {
            const rows = await backend.all({
                filters: flag === undefined ? [] : [{ flag: { equals: flag } }],
                orderBy: [
                    { field: 'flag', direction: 'asc' },
                    { field: 'scope', direction: 'asc' },
                    { field: 'target', direction: 'asc' },
                ],
            });

            return rows.map((row) => toRule(row as Row));
        },
        async upsert(input) {
            let saved: Row | undefined;
            try {
                saved = await write(await find(input.flag, input.scope, input.target), input);
            } catch (error) {
                // A concurrent writer may have created the same key between the read and the create.
                const raced = await find(input.flag, input.scope, input.target);
                if (!raced) {
                    throw error;
                }
                saved = await write(raced, input);
            }
            if (!saved) {
                throw new AppError('FEATURE_STORAGE_INVALID', 'A feature override could not be read back.');
            }

            return toRule(saved);
        },
        async remove(flag, scope, target) {
            return (await backend.delete(where(flag, scope, target))) > 0;
        },
    };
}
