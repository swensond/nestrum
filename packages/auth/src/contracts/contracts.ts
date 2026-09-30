import type { PrismaProvider } from '@nestrum/core';

/** Better Auth models Nestrum persists, including the `twoFactor` plugin's `TwoFactor` table. */
export const AUTH_MODELS = ['User', 'Session', 'Account', 'Verification', 'TwoFactor'] as const;
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
`;

const MONGODB = `model User {
    id String @id @map("_id")
    name String
    email String @unique
    emailVerified Bool
    image String?
    createdAt Date
    updatedAt Date
    twoFactorEnabled Bool?
}
model Session {
    id String @id @map("_id")
    token String @unique
    userId String
    expiresAt Date
    createdAt Date
    updatedAt Date
    ipAddress String?
    userAgent String?
}
model Account {
    id String @id @map("_id")
    accountId String
    providerId String
    userId String
    accessToken String?
    refreshToken String?
    idToken String?
    accessTokenExpiresAt Date?
    refreshTokenExpiresAt Date?
    scope String?
    password String?
    createdAt Date
    updatedAt Date
    @@unique([providerId, accountId])
}
model Verification {
    id String @id @map("_id")
    identifier String
    value String
    expiresAt Date
    createdAt Date
    updatedAt Date
}
model TwoFactor {
    id String @id @map("_id")
    secret String
    backupCodes String
    userId String
    verified Bool?
    failedVerificationCount Int?
    lockedUntil Date?
}
`;

export function authContract(provider: PrismaProvider): string {
    return provider === 'mongodb' ? MONGODB : POSTGRESQL;
}
