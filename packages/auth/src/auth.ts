import type {
    Application,
    Authentication,
    AuthenticationDefinition,
    AuthSession,
    DatabaseDefinition,
} from '@nestrum/core';
import { AppError, defineApp, modelIdentity } from '@nestrum/core';
import { betterAuth } from 'better-auth';
import type { AuthPrismaBinding } from '#auth/adapter/prisma-adapter';
import { createPrismaAuthAdapter } from '#auth/adapter/prisma-adapter';
import { AUTH_MODELS, authContract, TWO_FACTOR_MODELS } from '#auth/contracts/contracts';
import type { AuthField } from '#auth/contracts/fields';
import { userExtensions } from '#auth/contracts/fields';
import type { SubjectMapper } from '#auth/session/subject-factory';
import { SubjectFactory } from '#auth/session/subject-factory';
import { createTwoFactorService } from '#auth/two-factor/service';

export type AuthConfig = {
    readonly database?: string;
    readonly baseURL: string;
    readonly secret: string;
    readonly prisma: (context: {
        readonly database: string;
        readonly definition: DatabaseDefinition;
        readonly application: Application;
    }) => AuthPrismaBinding | Promise<AuthPrismaBinding>;
    readonly extend?: { readonly user?: Readonly<Record<string, AuthField>> };
    readonly trustedOrigins?: readonly string[];
    readonly subjectFactory?: SubjectMapper;
    readonly twoFactor?: {
        /** Authenticator-app issuer label. Defaults to "Nestrum". */
        readonly issuer?: string;
        /** Test seam: clock in milliseconds since the epoch used for TOTP steps, lockout and assurance expiry. */
        readonly now?: () => number;
    };
};

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
    const protectedModels = Object.freeze(
        [...AUTH_MODELS, ...TWO_FACTOR_MODELS].map((model) => modelIdentity(model, database)),
    );
    const issuer = config.twoFactor?.issuer ?? 'Nestrum';
    if (typeof issuer !== 'string' || !issuer.trim() || issuer.includes(':') || issuer.length > 64) {
        throw new AppError('AUTH_CONFIG_INVALID', 'Two-factor issuer must be a short label without a colon.');
    }
    const baseURL = origin(config.baseURL);
    if (config.trustedOrigins !== undefined && !Array.isArray(config.trustedOrigins)) {
        throw new AppError('AUTH_CONFIG_INVALID', 'Trusted auth origins must be an array.');
    }
    const trustedOrigins = Object.freeze((config.trustedOrigins ?? []).map(origin));
    const extensions = userExtensions(config.extend?.user);
    const subjectFactory = new SubjectFactory(config.subjectFactory);
    const secret = config.secret;
    const prisma = config.prisma;

    return Object.freeze({
        kind: 'better-auth' as const,
        database,
        protectedModels,
        createApp: (provider) =>
            defineApp({ name: 'nestrum.auth', prismaSource: { [database]: authContract(provider, extensions) } }),
        async initialize(application: Application): Promise<Authentication> {
            const definition = application.databases.get(database);
            const binding = await prisma({ application, database, definition });
            if (binding.database !== database) {
                throw new AppError('AUTH_DATABASE_MISMATCH', 'Auth storage must bind its selected named database.');
            }
            const instance = betterAuth({
                baseURL,
                basePath: '/api/auth',
                secret,
                trustedOrigins: [...trustedOrigins],
                database: createPrismaAuthAdapter(binding, definition.provider),
                emailAndPassword: { enabled: true },
                user: {
                    modelName: 'User',
                    additionalFields: Object.fromEntries(
                        Object.entries(extensions).map(([name, value]) => [name, { ...value }]),
                    ),
                },
                session: { modelName: 'Session', cookieCache: { enabled: false } },
                account: { modelName: 'Account' },
                verification: { modelName: 'Verification' },
                advanced: { database: { generateId: () => crypto.randomUUID() } },
            });
            await instance.$context;
            const getSession = async (request: Request): Promise<AuthSession | null> => {
                const session = await instance.api.getSession({
                    headers: request.headers,
                    query: { disableCookieCache: true, disableRefresh: true },
                });

                return session as AuthSession | null;
            };
            const twoFactor = createTwoFactorService({
                binding,
                provider: definition.provider,
                secret,
                issuer,
                ...(config.twoFactor?.now === undefined ? {} : { now: config.twoFactor.now }),
            });

            return Object.freeze({
                basePath: '/api/auth' as const,
                twoFactor,
                async handle(request: Request): Promise<Response> {
                    const path = new URL(request.url).pathname;
                    const requestOrigin = request.headers.get('origin');
                    if (requestOrigin && requestOrigin !== baseURL && !trustedOrigins.includes(requestOrigin)) {
                        return Response.json({ message: 'Invalid origin', code: 'INVALID_ORIGIN' }, { status: 403 });
                    }
                    const allowed =
                        request.method === 'POST'
                            ? ['/api/auth/sign-up/email', '/api/auth/sign-in/email', '/api/auth/sign-out']
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
