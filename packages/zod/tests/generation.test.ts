import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { Temporal } from '@js-temporal/polyfill';
import { defineApplication } from '@nestrum/core';
import { compileModelMetadata, prismaDatabase, PrismaMetadataError } from '@nestrum/prisma';
import type { ModelMetadata } from '@nestrum/prisma';
import { generatePrismaContracts } from '@nestrum/prisma/node';
import { generateModelSchemas } from '../src/index.js';

const SQL = `enum Status {
 ACTIVE
 ARCHIVED
}
model Project {
 id Int @id @default(autoincrement())
 name String
 description String?
 rating Float
 count BigInt
 enabled Boolean
 status Status
 tags String[]
 createdAt temporal.createdAtJsDate() @map("created")
 updatedAt temporal.updatedAtJsDate()
 date DateString
 at DateTime
 ownerId Int
 owner Owner @relation(fields: [ownerId], references: [id])
 @@map("projects")
}
model Owner {
 id Int @id
}
`;
const MONGO = `enum Status {
 ACTIVE
 ARCHIVED
}
model Article {
 id ObjectId @id @map("_id")
 title String
 description String?
 hits Int64
 weight Double
 enabled Bool
 tags String[]
 status Status
 when Date
 updatedAt temporal.updatedAt()
}
`;
const LEGACY = `datasource db {
 provider = "postgresql"
}
model Project {
 id String @id @default(cuid())
 name String
 description String?
 status String
 ownerId String
 createdAt DateTime @default(now())
 updatedAt DateTime @updatedAt
}
`;
let directory: string;
let sqlContract: unknown;
let sqlModels: readonly ModelMetadata[];
let mongoModels: readonly ModelMetadata[];
let legacyModels: readonly ModelMetadata[];

function project(): ModelMetadata {
    const metadata = sqlModels.find((model) => model.name === 'Project');
    if (!metadata) {
        throw new Error('Missing Project metadata.');
    }

    return metadata;
}

function article(): ModelMetadata {
    return mongoModels[0]!;
}

function temporal(name: string, value: string): unknown {
    const implementation = (globalThis as unknown as { Temporal: Record<string, { from(value: string): unknown }> }).Temporal;

    return implementation[name]!.from(value);
}

function projectValue() {
    return { id: 1, name: 'Project', description: null, rating: 3.5, count: 8n, enabled: true, status: 'ACTIVE', tags: ['a'],
        createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), date: '2026-01-01', at: temporal('Instant', '2026-01-01T00:00:00Z'), ownerId: 2 };
}

function articleValue() {
    return { _id: '507f1f77bcf86cd799439011', title: 'Article', hits: 1n, weight: 1.2, enabled: false, tags: ['a'], status: 'ARCHIVED',
        when: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') };
}

beforeAll(async () => {
    if (!(globalThis as unknown as { Temporal?: unknown }).Temporal) {
        vi.stubGlobal('Temporal', Temporal);
    }
    directory = await mkdtemp(join(tmpdir(), 'nestrum-schema-test-'));
    await writeFile(join(directory, 'sql.prisma'), SQL);
    await writeFile(join(directory, 'mongo.prisma'), MONGO);
    await writeFile(join(directory, 'legacy.prisma'), LEGACY);
    const databases = { default: prismaDatabase({ provider: 'postgresql', connection: 'unused' }), documents: prismaDatabase({ provider: 'mongodb', connection: 'unused' }) };
    const application = defineApplication({ databases, apps: [{ name: 'models', prisma: { default: ['sql.prisma'], documents: ['mongo.prisma'] } }] });
    const generation = await generatePrismaContracts(application, { rootDir: directory, outputDir: 'generated' });
    for (const contract of generation.contracts) {
        const input: unknown = JSON.parse(await readFile(contract.contractPath, 'utf8'));
        const metadata = compileModelMetadata({ database: contract.database, provider: contract.provider, contract: input });
        if (contract.database === 'default') {
            sqlContract = input;
            sqlModels = metadata;
        } else {
            mongoModels = metadata;
        }
    }
    const legacyApp = defineApplication({ databases, apps: [{ name: 'legacy', prisma: { default: ['legacy.prisma'] } }] });
    const legacy = await generatePrismaContracts(legacyApp, { rootDir: directory, outputDir: 'generated', authoring: { default: 'prisma7' } });
    legacyModels = compileModelMetadata({ database: 'default', provider: 'postgresql', contract: JSON.parse(await readFile(legacy.contracts[0]!.contractPath, 'utf8')) });
}, 30_000);

afterAll(async () => {
    vi.unstubAllGlobals();
    if (directory) {
        await rm(directory, { recursive: true, force: true });
    }
});

describe('Prisma 8 metadata compilation', () => {
    it('compiles stable canonical identities and sorted immutable metadata from real emitted contracts', () => {
        expect(sqlModels.map((model) => model.identity)).toEqual(['default.Owner', 'default.Project']);
        expect(mongoModels.map((model) => model.identity)).toEqual(['documents.Article']);
        expect(compileModelMetadata({ database: 'default', provider: 'postgresql', contract: sqlContract })).toEqual(sqlModels);
        expect(project().fields.map((field) => field.name)).toEqual([...project().fields.map((field) => field.name)].sort());
        for (const value of [sqlModels, project(), project().fields, project().fields[0], project().relations, project().relations[0]]) {
            expect(Object.isFrozen(value)).toBe(true);
        }
    });

    it('preserves relations and enums without including relations in data schemas', () => {
        expect(project().relations).toEqual([{ name: 'owner', target: 'default.Owner', cardinality: 'N:1', nullable: false, localFields: ['ownerId'], targetFields: ['id'] }]);
        expect(project().fields.find((field) => field.name === 'status')?.enumValues).toEqual(['ACTIVE', 'ARCHIVED']);
        expect(Object.isFrozen(project().fields.find((field) => field.name === 'status')?.enumValues)).toBe(true);
        expect(generateModelSchemas(project()).create.safeParse({ ...projectValue(), owner: { create: { id: 1 } } }).success).toBe(false);
    });

    it('reads SQL storage defaults and mutation defaults independently', () => {
        expect(project().fields.find((field) => field.name === 'id')).toMatchObject({ primaryKey: true, hasCreateDefault: true });
        expect(project().fields.find((field) => field.name === 'createdAt')).toMatchObject({ hasCreateDefault: true, hasUpdateDefault: false });
        expect(project().fields.find((field) => field.name === 'updatedAt')).toMatchObject({ hasCreateDefault: true, hasUpdateDefault: true });
    });

    it('distinguishes nullable SQL fields from optional Mongo fields and preserves native Mongo names', () => {
        expect(project().fields.find((field) => field.name === 'description')).toMatchObject({ nullable: true, optional: false });
        expect(article().fields.find((field) => field.name === 'description')).toMatchObject({ nullable: true, optional: true });
        expect(article().fields.find((field) => field.name === '_id')).toMatchObject({ primaryKey: true, codec: 'mongo/objectId@1' });
    });

    it('emits the frozen MVP model through the official explicit PostgreSQL compatibility adapter', () => {
        const metadata = legacyModels[0]!;
        expect(metadata.identity).toBe('default.Project');
        expect(metadata.fields.find((field) => field.name === 'id')).toMatchObject({ hasCreateDefault: true, kind: 'string' });
        expect(metadata.fields.find((field) => field.name === 'updatedAt')).toMatchObject({ hasCreateDefault: true, hasUpdateDefault: true, kind: 'temporal-datetime' });
        const schemas = generateModelSchemas(metadata);
        expect(schemas.create.safeParse({ name: 'Example', status: 'active', ownerId: 'owner' }).success).toBe(true);
        expect(schemas.read.safeParse({ id: 'id', name: 'Example', description: null, status: 'active', ownerId: 'owner',
            createdAt: temporal('PlainDateTime', '2026-01-01T00:00'), updatedAt: temporal('PlainDateTime', '2026-01-01T00:00') }).success).toBe(true);
    });

    it.each([null, {}, { schemaVersion: '2' }, [], 'contract'])('rejects invalid contract envelopes: %j', (contract) => {
        expect(() => compileModelMetadata({ database: 'default', provider: 'postgresql', contract })).toThrow(PrismaMetadataError);
    });

    it('rejects provider mismatches and unknown codecs with field identity', () => {
        expect(() => compileModelMetadata({ database: 'default', provider: 'mongodb', contract: sqlContract })).toThrow(PrismaMetadataError);
        const contract = structuredClone(sqlContract) as { domain: { namespaces: { public: { models: { Project: { fields: { name: { type: { codecId: string } } } } } } } } };
        contract.domain.namespaces.public.models.Project.fields.name.type.codecId = 'pg/new-codec@1';
        expect(() => compileModelMetadata({ database: 'default', provider: 'postgresql', contract })).toThrow('default.Project.name');
        expect(() => compileModelMetadata({ database: 'default', provider: 'postgresql', contract })).toThrow(expect.objectContaining({ code: 'PRISMA_CODEC_UNSUPPORTED' }));
    });

    it('rejects malformed fields and relation joins rather than producing weakened schemas', () => {
        const contract = structuredClone(sqlContract) as { domain: { namespaces: { public: { models: { Project: {
            fields: { name: { nullable: unknown } }; relations: { owner: { on: { targetFields: string[] } } }
        } } } } } };
        contract.domain.namespaces.public.models.Project.fields.name.nullable = 'false';
        expect(() => compileModelMetadata({ database: 'default', provider: 'postgresql', contract })).toThrow(PrismaMetadataError);
        contract.domain.namespaces.public.models.Project.fields.name.nullable = false;
        contract.domain.namespaces.public.models.Project.relations.owner.on.targetFields = ['missing'];
        expect(() => compileModelMetadata({ database: 'default', provider: 'postgresql', contract })).toThrow(PrismaMetadataError);
    });

    it('rejects unknown or incompatible authoring configuration before invoking Prisma', async () => {
        const databases = { default: prismaDatabase({ provider: 'postgresql', connection: 'unused' }), documents: prismaDatabase({ provider: 'mongodb', connection: 'unused' }) };
        const application = defineApplication({ databases, apps: [{ name: 'models', prisma: { default: ['sql.prisma'], documents: ['mongo.prisma'] } }] });
        for (const authoring of [{ missing: 'prisma7' as const }, { documents: 'prisma7' as const }]) {
            await expect(generatePrismaContracts(application, { rootDir: directory, outputDir: 'rejected', authoring })).rejects.toThrow('Invalid authoring mode');
        }
    });

    it('rejects duplicate model identities across SQL namespaces', () => {
        const contract = structuredClone(sqlContract) as { domain: { namespaces: Record<string, unknown> }; storage: { namespaces: Record<string, unknown> } };
        contract.domain.namespaces.other = structuredClone(contract.domain.namespaces.public);
        contract.storage.namespaces.other = structuredClone(contract.storage.namespaces.public);
        expect(() => compileModelMetadata({ database: 'default', provider: 'postgresql', contract })).toThrow(expect.objectContaining({ code: 'PRISMA_MODEL_AMBIGUOUS' }));
    });
});

describe('Framework-owned Zod families', () => {
    it('generates all six families with stable names and composable strict object schemas', () => {
        const schemas = generateModelSchemas(project());
        expect(schemas.names).toEqual({ model: 'ProjectModelSchema', create: 'ProjectCreateSchema', update: 'ProjectUpdateSchema', read: 'ProjectReadSchema', where: 'ProjectWhereSchema', orderBy: 'ProjectOrderBySchema' });
        expect(schemas.create.extend({ name: z.string().min(3) }).safeParse({ ...projectValue(), name: 'ab' }).success).toBe(false);
        expect(schemas.read.safeParse(projectValue()).success).toBe(true);
        expect(schemas.model.safeParse(projectValue()).success).toBe(true);
        expect(Object.isFrozen(schemas)).toBe(true);
    });

    it('makes create defaults and nullable fields omittable while keeping read records complete', () => {
        const schemas = generateModelSchemas(project());
        const { id, createdAt, updatedAt, description, ...input } = projectValue();
        expect(schemas.create.safeParse(input).success).toBe(true);
        expect(schemas.read.safeParse(input).success).toBe(false);
        expect(schemas.create.safeParse({ ...input, enabled: undefined }).success).toBe(false);
        expect(schemas.read.safeParse({ ...projectValue(), description: undefined }).success).toBe(false);
        expect(schemas.create.parse(input)).not.toHaveProperty('id');
    });

    it('accepts partial updates, forbids primary key updates, and rejects unknown/nested writes', () => {
        const schemas = generateModelSchemas(project());
        expect(schemas.update.safeParse({ name: 'Changed', description: null }).success).toBe(true);
        expect(schemas.update.safeParse({}).success).toBe(true);
        expect(schemas.update.safeParse({ id: 2 }).success).toBe(false);
        expect(schemas.update.safeParse({ name: null }).success).toBe(false);
        expect(schemas.create.safeParse({ ...projectValue(), typo: 'unexpected' }).success).toBe(false);
    });

    it.each([
        ['name', 1], ['rating', Infinity], ['count', 1], ['count', 2n ** 63n], ['enabled', 'true'], ['status', 'OTHER'],
        ['tags', [1]], ['tags', [null]], ['id', 1.5], ['id', 2 ** 31], ['date', '2026-02-30'], ['createdAt', '2026-01-01'],
        ['createdAt', new Date(NaN)], ['at', new Date()], ['name', undefined]
    ])('rejects invalid SQL %s values', (field, value) => {
        expect(generateModelSchemas(project()).read.safeParse({ ...projectValue(), [field]: value }).success).toBe(false);
    });

    it('validates native Mongo object ids, bigint, dates, enums and arrays with missing/null distinctions', () => {
        const schemas = generateModelSchemas(article());
        expect(schemas.read.safeParse(articleValue()).success).toBe(true);
        expect(schemas.read.safeParse({ ...articleValue(), description: null }).success).toBe(true);
        expect(schemas.read.safeParse({ ...articleValue(), _id: 'bad' }).success).toBe(false);
        expect(schemas.read.safeParse({ ...articleValue(), id: '507f1f77bcf86cd799439011' }).success).toBe(false);
        expect(schemas.read.safeParse({ ...articleValue(), hits: 1 }).success).toBe(false);
        expect(schemas.read.safeParse({ ...articleValue(), when: '2026-01-01' }).success).toBe(false);
        expect(schemas.read.safeParse({ ...articleValue(), tags: ['a', null] }).success).toBe(false);
        const { updatedAt, ...input } = articleValue();
        expect(schemas.create.safeParse(input).success).toBe(true);
        expect(schemas.read.safeParse(input).success).toBe(false);
    });

    it('supports explicit Temporal implementations and rejects objects with forged prototypes', () => {
        const schemas = generateModelSchemas(project(), { temporal: Temporal });
        expect(schemas.read.safeParse({ ...projectValue(), at: Temporal.Instant.from('2026-01-01T00:00Z') }).success).toBe(true);
        expect(schemas.read.safeParse({ ...projectValue(), at: Object.create(Temporal.Instant.prototype) }).success).toBe(false);
    });

    it('fails Temporal validation clearly without an implementation while ordinary dates keep working', () => {
        const schemas = generateModelSchemas(project(), { temporal: {} });
        expect(schemas.read.safeParse(projectValue()).success).toBe(false);
        expect(generateModelSchemas(article()).read.safeParse(articleValue()).success).toBe(true);
    });

    it('rejects Where operator name collisions rather than silently replacing a field', () => {
        const metadata = { ...project(), fields: [{ ...project().fields[0]!, name: 'AND' }] };
        expect(() => generateModelSchemas(metadata)).toThrow('reserved Where operator');
    });

    it('generates recursive field-aware filters and scalar ordering', () => {
        const schemas = generateModelSchemas(project());
        expect(schemas.where.safeParse({ AND: [{ name: { contains: 'hello' } }, { OR: [{ status: 'ACTIVE' }, { description: null }] }], count: { gte: 2n }, tags: { has: 'a' } }).success).toBe(true);
        expect(schemas.where.safeParse({ NOT: { enabled: true }, id: { in: [1, 2] } }).success).toBe(true);
        expect(schemas.where.safeParse({ id: { contains: '1' } }).success).toBe(false);
        expect(schemas.where.safeParse({ status: 'other' }).success).toBe(false);
        expect(schemas.where.safeParse({ OR: [{ unknown: 1 }] }).success).toBe(false);
        expect(schemas.where.safeParse({ owner: { id: 2 } }).success).toBe(false);
        expect(schemas.orderBy.safeParse({ name: 'asc', createdAt: 'desc' }).success).toBe(true);
        expect(schemas.orderBy.safeParse({ name: 'ascending' }).success).toBe(false);
        expect(schemas.orderBy.safeParse({ owner: 'asc' }).success).toBe(false);
    });
});
