import type {
    Application,
    AuthAdministratorInput,
    Authentication,
    AuthenticationDefinition,
    AuthSession,
    DatabaseDefinition,
} from '@nestrum/core';
import { AppError, defineApp, modelIdentity } from '@nestrum/core';
import { betterAuth } from 'better-auth';
import type { DBAdapterInstance } from 'better-auth/adapters';
import { admin, twoFactor } from 'better-auth/plugins';
import type { AuthPrismaBinding } from '#auth/adapter/prisma-adapter';
import { createPrismaAuthAdapter } from '#auth/adapter/prisma-adapter';
import { AUTH_MODELS, authContract } from '#auth/contracts/contracts';
import { AUTH_ROLE_DEFINITIONS } from '#auth/roles/roles';
import { createAdministrator, createUserManagement } from '#auth/roles/users';
import type { SubjectMapper } from '#auth/session/subject-factory';
import { SubjectFactory } from '#auth/session/subject-factory';

export type AuthConfig = {
    readonly database?: string;
    readonly baseURL: string;
    readonly secret: string;
    readonly prisma: (context: {
        readonly database: string;
        readonly definition: DatabaseDefinition;
        readonly application: Application;
    }) => AuthPrismaBinding | Promise<AuthPrismaBinding>;
    readonly trustedOrigins?: readonly string[];
    readonly subjectFactory?: SubjectMapper;
    /** Better Auth `twoFactor` plugin settings that Nestrum exposes. */
    readonly twoFactor?: {
        /** Authenticator-app issuer label. Defaults to "Nestrum". */
        readonly issuer?: string;
        /** Consecutive failed verifications before an account locks. Defaults to 10. */
        readonly maxFailedAttempts?: number;
        /** Lock duration in seconds. Defaults to 900. */
        readonly lockoutSeconds?: number;
    };
};

/** Second-factor endpoints forwarded to Better Auth; OTP-by-message and trusted-device flows stay unexposed. */
const TWO_FACTOR_PATHS = [
    '/api/auth/two-factor/enable',
    '/api/auth/two-factor/disable',
    '/api/auth/two-factor/verify-totp',
    '/api/auth/two-factor/verify-backup-code',
    '/api/auth/two-factor/generate-backup-codes',
] as const;

function origin(value: string): string {
    try {
        const url = new URL(value);
        if (
            !['http:', 'https:'].includes(url.protocol) ||
            url.username ||
            url.password ||
            url.origin !== value.replace(/\/$/, '')
        ) {
            throw new Error();
        }

        return url.origin;
    } catch {
        throw new AppError('AUTH_CONFIG_INVALID', 'Auth URLs must be absolute HTTP(S) origins.');
    }
}

type AuthInstanceOptions = {
    readonly baseURL: string;
    readonly secret: string;
    readonly trustedOrigins: readonly string[];
    readonly database: DBAdapterInstance;
    readonly issuer: string;
    readonly maxFailedAttempts: number;
    readonly lockoutSeconds: number;
};

/** The one place Better Auth is configured, so tests can compare its schema with the prebaked contract. */
export function createAuthInstance(options: AuthInstanceOptions) {
    return betterAuth({
        baseURL: options.baseURL,
        basePath: '/api/auth',
        secret: options.secret,
        trustedOrigins: [...options.trustedOrigins],
        database: options.database,
        emailAndPassword: { enabled: true },
        user: { modelName: 'User' },
        plugins: [
            admin({
                roles: AUTH_ROLE_DEFINITIONS,
                adminRoles: ['admin'],
                defaultRole: 'user',
            }),
            twoFactor({
                issuer: options.issuer,
                twoFactorTable: 'TwoFactor',
                accountLockout: {
                    enabled: true,
                    maxFailedAttempts: options.maxFailedAttempts,
                    durationSeconds: options.lockoutSeconds,
                },
            }),
        ],
        session: { modelName: 'Session', cookieCache: { enabled: false } },
        account: { modelName: 'Account' },
        verification: { modelName: 'Verification' },
        advanced: { database: { generateId: () => crypto.randomUUID() } },
    });
}

export function defineAuth(config: AuthConfig): AuthenticationDefinition {
    if (
        !config ||
        typeof config.secret !== 'string' ||
        config.secret.length < 32 ||
        typeof config.prisma !== 'function' ||
        (config.subjectFactory !== undefined && typeof config.subjectFactory !== 'function')
    ) {
        throw new AppError(
            'AUTH_CONFIG_INVALID',
            'Auth requires a secret of at least 32 characters and a Prisma storage factory.',
        );
    }
    const database = config.database ?? 'default';
    const protectedModels = Object.freeze(AUTH_MODELS.map((model) => modelIdentity(model, database)));
    const baseURL = origin(config.baseURL);
    if (config.trustedOrigins !== undefined && !Array.isArray(config.trustedOrigins)) {
        throw new AppError('AUTH_CONFIG_INVALID', 'Trusted auth origins must be an array.');
    }
    const trustedOrigins = Object.freeze((config.trustedOrigins ?? []).map(origin));
    const issuer = config.twoFactor?.issuer ?? 'Nestrum';
    const maxFailedAttempts = config.twoFactor?.maxFailedAttempts ?? 10;
    const lockoutSeconds = config.twoFactor?.lockoutSeconds ?? 900;
    if (
        typeof issuer !== 'string' ||
        !issuer.trim() ||
        issuer.includes(':') ||
        issuer.length > 64 ||
        !Number.isInteger(maxFailedAttempts) ||
        maxFailedAttempts < 1 ||
        !Number.isInteger(lockoutSeconds) ||
        lockoutSeconds < 1
    ) {
        throw new AppError(
            'AUTH_CONFIG_INVALID',
            'Two-factor needs a short issuer without a colon and positive integer lockout settings.',
        );
    }
    const subjectFactory = new SubjectFactory(config.subjectFactory);
    const secret = config.secret;
    const prisma = config.prisma;

    return Object.freeze({
        kind: 'better-auth' as const,
        database,
        protectedModels,
        createApp: (provider) =>
            defineApp({ name: 'nestrum.auth', prismaSource: { [database]: authContract(provider) } }),
        async initialize(application: Application): Promise<Authentication> {
            const definition = application.databases.get(database);
            const binding = await prisma({ application, database, definition });
            if (binding.database !== database) {
                throw new AppError('AUTH_DATABASE_MISMATCH', 'Auth storage must bind its selected named database.');
            }
            const instance = createAuthInstance({
                baseURL,
                secret,
                trustedOrigins,
                database: createPrismaAuthAdapter(binding, definition.provider),
                issuer,
                maxFailedAttempts,
                lockoutSeconds,
            });
            await instance.$context;
            const getSession = async (request: Request): Promise<AuthSession | null> => {
                const session = await instance.api.getSession({
                    headers: request.headers,
                    query: { disableCookieCache: true, disableRefresh: true },
                });

                return session as AuthSession | null;
            };
            return Object.freeze({
                basePath: '/api/auth' as const,
                users: createUserManagement(instance),
                createAdministrator: (input: AuthAdministratorInput) => createAdministrator(instance, input),
                async handle(request: Request): Promise<Response> {
                    const path = new URL(request.url).pathname;
                    const requestOrigin = request.headers.get('origin');
                    if (requestOrigin && requestOrigin !== baseURL && !trustedOrigins.includes(requestOrigin)) {
                        return Response.json({ message: 'Invalid origin', code: 'INVALID_ORIGIN' }, { status: 403 });
                    }
                    const allowed =
                        request.method === 'POST'
                            ? [
                                  '/api/auth/sign-up/email',
                                  '/api/auth/sign-in/email',
                                  '/api/auth/sign-out',
                                  ...TWO_FACTOR_PATHS,
                              ]
                            : request.method === 'GET'
                              ? ['/api/auth/get-session']
                              : [];
                    if (!allowed.includes(path)) {
                        return Response.json(
                            { error: { code: 'NOT_FOUND', message: 'Route not found.' } },
                            { status: 404 },
                        );
                    }

                    return instance.handler(request);
                },
                getSession,
                resolveSubject: async (request: Request) => subjectFactory.create(await getSession(request)),
            });
        },
    });
}
