import type { FeatureRule, FeatureRuleScope, FeatureStore } from './features.types.js';

/** Non-persistent store: the default when no database is configured, and the fixture for tests. */
export class MemoryFeatureStore implements FeatureStore {
    private readonly rules = new Map<string, FeatureRule>();
    private counter = 0;

    private static key(flag: string, scope: FeatureRuleScope, target: string): string {
        return JSON.stringify([flag, scope, target]);
    }

    async list(flag?: string): Promise<readonly FeatureRule[]> {
        return [...this.rules.values()].filter((rule) => flag === undefined || rule.flag === flag);
    }

    async upsert(input: Parameters<FeatureStore['upsert']>[0]): Promise<FeatureRule> {
        const key = MemoryFeatureStore.key(input.flag, input.scope, input.target);
        const rule: FeatureRule = Object.freeze({
            id: this.rules.get(key)?.id ?? `memory-${++this.counter}`,
            ...input,
            updatedAt: new Date().toISOString(),
        });
        this.rules.set(key, rule);

        return rule;
    }

    async remove(flag: string, scope: FeatureRuleScope, target: string): Promise<boolean> {
        return this.rules.delete(MemoryFeatureStore.key(flag, scope, target));
    }
}
