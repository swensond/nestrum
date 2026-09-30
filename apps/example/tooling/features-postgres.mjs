// Real-database check of feature flags: Nestrum's FeatureOverride model through the Prisma query backend on PostgreSQL.
//
// Not part of `pnpm check`: it needs a reachable identity database migrated with the example identity contract.
//   INTEGRATION_IDENTITY_URL   PostgreSQL URL of a database migrated with the example identity contract
//   NESTRUM_CONTRACT_JSON      path to that database's generated contract.json
// It exercises persistence and readback, the unique (flag, scope, target) key under concurrent writers, precedence and
// rollouts over stored rules, audit events, and the source-default fallback when storage is unavailable.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defineApplication, defineFeatureFlags } from '@nestrum/core';
import postgres from '@nestrum/example-postgres';
import { defineFeatures } from '@nestrum/features';

const url = process.env.INTEGRATION_IDENTITY_URL;
const client = postgres({ contractJson: JSON.parse(readFileSync(process.env.NESTRUM_CONTRACT_JSON, 'utf8')), url });
const flags = defineFeatureFlags({
    newDashboard: { default: false, exposeToClient: true },
    experimentalSearch: { default: true },
});
const events = [];
const errors = [];
const application = defineApplication({
    apps: [],
    databases: {
        default: { kind: 'prisma', provider: 'postgresql', connection: url },
        identity: { kind: 'prisma', provider: 'postgresql', connection: url },
    },
    features: defineFeatures({
        flags,
        database: 'identity',
        environment: 'verify',
        prisma: () => ({ database: 'identity', collection: client.orm.public.FeatureOverride }),
        onChange: [(event) => events.push(event)],
        onError: (error) => errors.push(error),
    }),
    databaseLifecycle: {
        default: { connect: async () => {}, disconnect: async () => {} },
        identity: { connect: async () => client.connect(), disconnect: async () => client.close() },
    },
});
await application.start();
try {
    const { manager, evaluator } = application.features;
    const table = client.orm.public.FeatureOverride;
    for (const row of await table.all()) {
        await manager.remove(row.flag, row.scope, row.target);
    }
    assert.equal(await evaluator.enabled('newDashboard'), false);
    assert.equal(await evaluator.enabled('experimentalSearch'), true);

    const saved = await manager.set({ flag: 'newDashboard', scope: 'global', enabled: true }, 'verifier');
    assert.equal(saved.updatedBy, 'verifier');
    assert.ok(!Number.isNaN(Date.parse(saved.updatedAt)));
    assert.equal(await evaluator.enabled('newDashboard'), true);
    const raw = await table.where({ flag: 'newDashboard' }).all();
    assert.equal(raw.length, 1);
    assert.equal(raw[0].enabled, true);
    const again = await manager.set({ flag: 'newDashboard', scope: 'global', enabled: false }, 'verifier');
    assert.equal(again.id, saved.id, 'An existing key is updated, not duplicated.');
    assert.equal((await table.where({ flag: 'newDashboard' }).all()).length, 1);
    console.log('Real PostgreSQL feature override persistence, readback and update passed.');

    // Concurrent writers of one key converge on a single row.
    await Promise.allSettled(
        Array.from({ length: 8 }, (_, index) =>
            manager.set({ flag: 'newDashboard', scope: 'subject', target: 'racer', enabled: index % 2 === 0 }),
        ),
    );
    assert.equal((await table.where({ flag: 'newDashboard', scope: 'subject', target: 'racer' }).all()).length, 1);
    console.log('Real PostgreSQL unique-key convergence under concurrent writers passed.');

    // Precedence over stored rules, and a deterministic rollout with a fractional percentage.
    await manager.set({ flag: 'newDashboard', scope: 'organization', target: 'acme', enabled: true });
    await manager.set({ flag: 'newDashboard', scope: 'subject', target: 'vip', enabled: false });
    assert.equal(await evaluator.enabled('newDashboard', { organizationId: 'acme' }), true);
    assert.equal(await evaluator.enabled('newDashboard', { organizationId: 'acme', stableId: 'vip' }), false);
    await manager.set({ flag: 'newDashboard', scope: 'percentage', percentage: 12.5 });
    const users = Array.from({ length: 400 }, (_, index) => `user-${index}`);
    const first = await Promise.all(users.map((id) => evaluator.enabled('newDashboard', { stableId: id })));
    const second = await Promise.all(users.map((id) => evaluator.enabled('newDashboard', { stableId: id })));
    assert.deepEqual(first, second);
    const share = first.filter(Boolean).length / users.length;
    assert.ok(share > 0.05 && share < 0.22, `Rollout share ${share}`);
    assert.equal(
        (await table.where({ flag: 'newDashboard', scope: 'percentage' }).all())[0].percentage,
        12.5,
        'The fractional percentage round-trips exactly.',
    );
    assert.equal(await evaluator.enabled('newDashboard', { organizationId: 'acme', stableId: 'vip' }), false);
    console.log('Real PostgreSQL stored-rule precedence and deterministic rollout passed.');

    assert.ok(events.length >= 12 && events.every((event) => event.at));
    assert.equal(events[0].actor, 'verifier');
    for (const row of await table.all()) {
        assert.equal(await manager.remove(row.flag, row.scope, row.target, 'verifier'), true);
    }
    assert.equal((await table.all()).length, 0);
    assert.equal(await evaluator.enabled('newDashboard', { stableId: 'user-1' }), false);
    assert.equal(errors.length, 0);

    // Storage failure falls back to the source default and reports the error.
    await client.close();
    const degraded = await evaluator.evaluate('experimentalSearch');
    assert.deepEqual(degraded.reason, { source: 'default', degraded: true });
    assert.equal(degraded.enabled, true);
    assert.equal(errors.length, 1);
    console.log('Real PostgreSQL storage-failure fallback to source defaults passed.');
} finally {
    await application.shutdown().catch(() => undefined);
}
