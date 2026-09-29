import type { PrismaProvider } from '@nestrum/core';
import type { AuthFieldDescriptor } from './fields.js';

export const AUTH_MODELS = ['User', 'Session', 'Account', 'Verification'] as const;
export type AuthModel = (typeof AUTH_MODELS)[number];

export function authContract(
    provider: PrismaProvider,
    extensions: Readonly<Record<string, AuthFieldDescriptor>>,
): string {
    const mongo = provider === 'mongodb';
    const date = mongo ? 'Date' : 'TimestamptzString';
    const boolean = mongo ? 'Bool' : 'Boolean';
    const key = `String @id${mongo ? ' @map("_id")' : ''}`;
    const extensionSource = Object.entries(extensions)
        .map(
            ([name, field]) =>
                `    ${name} ${field.type === 'string' ? 'String' : field.type === 'boolean' ? boolean : mongo ? 'Double' : 'Float'}${field.required ? '' : '?'}`,
        )
        .join('\n');
    const reference = mongo ? '' : '\n    user User @relation(fields: [userId], references: [id], onDelete: Cascade)';

    return `model User {
    id ${key}
    name String
    email String @unique
    emailVerified ${boolean}
    image String?
    createdAt ${date}
    updatedAt ${date}
${extensionSource}
}
model Session {
    id ${key}
    token String @unique
    userId String
    expiresAt ${date}
    createdAt ${date}
    updatedAt ${date}
    ipAddress String?
    userAgent String?${reference}
}
model Account {
    id ${key}
    accountId String
    providerId String
    userId String
    accessToken String?
    refreshToken String?
    idToken String?
    accessTokenExpiresAt ${date}?
    refreshTokenExpiresAt ${date}?
    scope String?
    password String?
    createdAt ${date}
    updatedAt ${date}${reference}
    @@unique([providerId, accountId])
}
model Verification {
    id ${key}
    identifier String
    value String
    expiresAt ${date}
    createdAt ${date}
    updatedAt ${date}
}
`;
}
