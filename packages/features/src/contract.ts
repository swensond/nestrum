/** Nestrum-owned models for persisted feature overrides. Applications never declare these themselves. */
export const FEATURE_MODELS = ['FeatureOverride'] as const;

// `target` is `''` for global and percentage rules so the unique key never needs a nullable column.
const POSTGRESQL = `model FeatureOverride {
    id String @id
    flag String
    scope String
    target String
    enabled Boolean
    percentage Float?
    updatedBy String?
    createdAt TimestamptzString
    updatedAt TimestamptzString
    @@unique([flag, scope, target])
    @@index([flag])
}
`;

export function featureContract(): string {
    return POSTGRESQL;
}
