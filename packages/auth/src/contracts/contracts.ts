/** Better Auth models Nestrum persists, including the `twoFactor` plugin's `TwoFactor` and the API-key plugin's `ApiKey` and the SSO plugin's `SsoProvider` tables. */
export const AUTH_MODELS = [
    'User',
    'Session',
    'Account',
    'Verification',
    'TwoFactor',
    'ApiKey',
    'SsoProvider',
] as const;
export type AuthModel = (typeof AUTH_MODELS)[number];

// The contract is fixed, so it is written out per provider instead of being assembled. `contracts.test.ts` checks
// each model and field against Better Auth's own schema for the configured plugins, so upgrades cannot drift silently.
const POSTGRESQL = `model User {
    id String @id
    name String
    email String @unique
    emailVerified Boolean
    image String?
    createdAt TimestamptzString
    updatedAt TimestamptzString
    twoFactorEnabled Boolean?
    role String?
    banned Boolean?
    banReason String?
    banExpires TimestamptzString?
}
model Session {
    id String @id
    token String @unique
    userId String
    expiresAt TimestamptzString
    createdAt TimestamptzString
    updatedAt TimestamptzString
    ipAddress String?
    userAgent String?
    impersonatedBy String?
    authMethod String?
    ssoProviderId String?
    user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
model Account {
    id String @id
    accountId String
    providerId String
    userId String
    accessToken String?
    refreshToken String?
    idToken String?
    accessTokenExpiresAt TimestamptzString?
    refreshTokenExpiresAt TimestamptzString?
    scope String?
    password String?
    createdAt TimestamptzString
    updatedAt TimestamptzString
    user User @relation(fields: [userId], references: [id], onDelete: Cascade)
    @@unique([providerId, accountId])
}
model Verification {
    id String @id
    identifier String
    value String
    expiresAt TimestamptzString
    createdAt TimestamptzString
    updatedAt TimestamptzString
}
model TwoFactor {
    id String @id
    secret String
    backupCodes String
    userId String
    verified Boolean?
    failedVerificationCount Int?
    lockedUntil TimestamptzString?
    user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
model ApiKey {
    id String @id
    configId String
    name String?
    start String?
    referenceId String
    prefix String?
    key String
    refillInterval Int?
    refillAmount Int?
    lastRefillAt TimestamptzString?
    enabled Boolean?
    rateLimitEnabled Boolean?
    rateLimitTimeWindow Int?
    rateLimitMax Int?
    requestCount Int?
    remaining Int?
    lastRequest TimestamptzString?
    expiresAt TimestamptzString?
    createdAt TimestamptzString
    updatedAt TimestamptzString
    permissions String?
    metadata String?
    @@index([key])
    @@index([referenceId])
}
model SsoProvider {
    id String @id
    issuer String
    oidcConfig String?
    samlConfig String?
    userId String?
    providerId String @unique
    organizationId String?
    domain String
    domainVerified Boolean?
    displayName String?
    enabled Boolean?
    createdBy String?
    updatedBy String?
    lastValidatedAt TimestamptzString?
    lastValidationStatus String?
    lastSuccessfulLoginAt TimestamptzString?
    createdAt TimestamptzString
    updatedAt TimestamptzString
    @@index([domain])
}
`;

export function authContract(): string {
    return POSTGRESQL;
}
