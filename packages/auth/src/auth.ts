import { apiKey } from '@better-auth/api-key';
import { sso } from '@better-auth/sso';
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
import type { AuthPrismaBinding, AuthRowCodec } from '#auth/adapter/prisma-adapter';
import { createPrismaAuthAdapter } from '#auth/adapter/prisma-adapter';
import type { ApiKeyOptions, ResolvedApiKeyOptions } from '#auth/api-keys/options';
import { resolveApiKeyOptions } from '#auth/api-keys/options';
import { createApiKeys } from '#auth/api-keys/service';
import { AUTH_MODELS, authContract } from '#auth/contracts/contracts';
import { AUTH_ROLE_DEFINITIONS } from '#auth/roles/roles';
import { createAdministrator, createUserManagement } from '#auth/roles/users';
import type { SubjectMapper } from '#auth/session/subject-factory';
import { SubjectFactory } from '#auth/session/subject-factory';
import type { ResolvedSsoOptions, SsoConfig } from '#auth/sso/options';
import { resolveSsoOptions } from '#auth/sso/options';
import { handleSso, isSamlAcsPost } from '#auth/sso/routes';
import { openProviderConfig, SecretBox, sealProviderConfig } from '#auth/sso/secrets';
import { SsoRegistry } from '#auth/sso/service';

export type AuthConfig = {
    readonly baseURL: string;
    readonly secret: string;
    readonly prisma: (context: {
        readonly definition: DatabaseDefinition;
        readonly application: Application;
    }) => AuthPrismaBinding | Promise<AuthPrismaBinding>;
    readonly trustedOrigins?: readonly string[];
    readonly subjectFactory?: SubjectMapper;
    /** Better Auth `twoFactor` plugin settings that Nestrum exposes. */
    /** Better Auth `apiKey` plugin settings that Nestrum exposes. */
    readonly apiKeys?: ApiKeyOptions;
    /** Enterprise SSO (OIDC and SAML 2.0) on Better Auth's SSO plugin. Off unless `enabled` is true. */
    readonly sso?: SsoConfig;
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
    readonly apiKeys: ResolvedApiKeyOptions;
    readonly sso?: {
        readonly options: ResolvedSsoOptions;
        readonly registry: () => SsoRegistry | undefined;
    };
};

/** The one place Better Auth is configured, so tests can compare its schema with the prebaked contract. */
export function createAuthInstance(options: AuthInstanceOptions) {
    return betterAuth({
        baseURL: options.baseURL,
        basePath: '/api/auth',
        secret: options.secret,
        // IdP origins of enabled SSO providers are trusted dynamically; browser-facing origin checks stay static in `handle`.
        trustedOrigins: options.sso
            ? async () => [...options.trustedOrigins, ...((await options.sso?.registry()?.idpOrigins()) ?? [])]
            : [...options.trustedOrigins],
        database: options.database,
        emailAndPassword: { enabled: true },
        user: { modelName: 'User' },
        plugins: [
            admin({
                roles: AUTH_ROLE_DEFINITIONS,
                adminRoles: ['admin'],
                defaultRole: 'user',
            }),
            // Keys are verified and managed only through server-side calls; `enableSessionForAPIKeys` stays off so a
            // key never becomes a Better Auth session, and none of the plugin's HTTP endpoints are forwarded.
            apiKey({
                configId: 'default',
                defaultPrefix: options.apiKeys.prefix,
                startingCharactersConfig: { shouldStore: true, charactersLength: options.apiKeys.prefix.length + 4 },
                requireName: true,
                maximumNameLength: 64,
                enableMetadata: true,
                disableKeyHashing: false,
                enableSessionForAPIKeys: false,
                references: 'user',
                keyExpiration: {
                    defaultExpiresIn:
                        options.apiKeys.defaultTtlDays === null ? null : options.apiKeys.defaultTtlDays * 86_400,
                    maxExpiresIn: options.apiKeys.maxTtlDays,
                },
                rateLimit: {
                    enabled: options.apiKeys.rateLimit.enabled,
                    maxRequests: options.apiKeys.rateLimit.requests,
                    timeWindow: options.apiKeys.rateLimit.windowSeconds * 1000,
                },
                schema: { apikey: { modelName: 'ApiKey' } },
            }),
            ...(options.sso
                ? [
                      // Provider writes go through Nestrum's registry, so the plugin's own registration endpoint is off
                      // (`providersLimit: 0`) and none of its management endpoints are forwarded over HTTP.
                      sso({
                          modelName: 'SsoProvider',
                          providersLimit: 0,
                          ...options.sso.options.provisioning,
                          saml: { allowIdpInitiated: options.sso.options.allowIdpInitiated },
                          domainVerification: options.sso.options.domainVerification.enabled
                              ? { enabled: true, tokenPrefix: 'nestrum-sso' }
                              : { enabled: false },
                          schema: {
                              ssoProvider: {
                                  additionalFields: {
                                      displayName: { type: 'string', required: false, input: false },
                                      enabled: { type: 'boolean', required: false, input: false },
                                      createdBy: { type: 'string', required: false, input: false },
                                      updatedBy: { type: 'string', required: false, input: false },
                                      lastValidatedAt: { type: 'date', required: false, input: false },
                                      lastValidationStatus: { type: 'string', required: false, input: false },
                                      lastSuccessfulLoginAt: { type: 'date', required: false, input: false },
                                      createdAt: { type: 'date', required: true, input: false },
                                      updatedAt: { type: 'date', required: true, input: false },
                                  },
                              },
                          },
                      }),
                  ]
                : []),
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
        session: {
            modelName: 'Session',
            cookieCache: { enabled: false },
            // How the session began. Set only by the SSO callbacks below, never from client input.
            additionalFields: {
                authMethod: { type: 'string', required: false, input: false },
                ssoProviderId: { type: 'string', required: false, input: false },
            },
        },
        databaseHooks: {
            session: {
                create: {
                    before: async (session, context) => {
                        const path = context?.path ?? '';
                        const providerId = (context?.params as { providerId?: string } | undefined)?.providerId;
                        if (
                            options.sso &&
                            providerId &&
                            (path.startsWith('/sso/callback/') || path.startsWith('/sso/saml2/sp/acs/'))
                        ) {
                            return { data: { ...session, authMethod: 'sso', ssoProviderId: providerId } };
                        }

                        return { data: session };
                    },
                    after: async (session) => {
                        const record = session as { authMethod?: string; ssoProviderId?: string };
                        if (options.sso && record.authMethod === 'sso' && record.ssoProviderId) {
                            await options.sso
                                .registry()
                                ?.recordLogin(record.ssoProviderId)
                                .catch(() => {});
                        }
                    },
                },
            },
        },
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
    const protectedModels = Object.freeze(AUTH_MODELS.map((model) => modelIdentity(model)));
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
    const apiKeys = resolveApiKeyOptions(config.apiKeys);
    const ssoOptions = resolveSsoOptions(config.sso);
    const subjectFactory = new SubjectFactory(config.subjectFactory);
    const secret = config.secret;
    const prisma = config.prisma;

    return Object.freeze({
        kind: 'better-auth' as const,
        protectedModels,
        createApp: () => defineApp({ name: 'nestrum.auth', prismaSource: authContract() }),
        async initialize(application: Application): Promise<Authentication> {
            const definition = application.database;
            const binding = await prisma({ application, definition });
            const box = new SecretBox(secret);
            const isSsoModel = (model: string) => model.toLowerCase() === 'ssoprovider';
            const codec: AuthRowCodec | undefined = ssoOptions
                ? {
                      seal: async (model, row) => (isSsoModel(model) ? sealProviderConfig(box, row) : row),
                      open: async (model, row) => (isSsoModel(model) ? openProviderConfig(box, row) : row),
                  }
                : undefined;
            let registry: SsoRegistry | undefined;
            const instance = createAuthInstance({
                baseURL,
                secret,
                trustedOrigins,
                database: createPrismaAuthAdapter(binding, codec),
                issuer,
                maxFailedAttempts,
                lockoutSeconds,
                apiKeys,
                ...(ssoOptions
                    ? {
                          sso: { options: ssoOptions, registry: () => registry },
                      }
                    : {}),
            });
            await instance.$context;
            if (ssoOptions) {
                registry = new SsoRegistry({
                    // biome-ignore lint/suspicious/noExplicitAny: the registry uses a narrow structural slice of the context
                    store: async () => (await instance.$context) as any,
                    baseURL,
                    options: ssoOptions,
                });
            }
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
                apiKeys: createApiKeys(instance, apiKeys),
                ...(registry ? { sso: registry } : {}),
                createAdministrator: (input: AuthAdministratorInput) => createAdministrator(instance, input),
                async handle(request: Request): Promise<Response> {
                    const path = new URL(request.url).pathname;
                    const requestOrigin = request.headers.get('origin');
                    if (
                        requestOrigin &&
                        requestOrigin !== baseURL &&
                        !trustedOrigins.includes(requestOrigin) &&
                        !(registry && isSamlAcsPost(request, path))
                    ) {
                        return Response.json({ message: 'Invalid origin', code: 'INVALID_ORIGIN' }, { status: 403 });
                    }
                    if (registry) {
                        const handled = await handleSso(
                            request,
                            path,
                            registry,
                            (forwarded) => instance.handler(forwarded),
                            { origins: [baseURL, ...trustedOrigins] },
                        );
                        if (handled) {
                            return handled;
                        }
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
