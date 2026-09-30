import type { Application } from '#core/application/application';
import type { AppDefinition } from '#core/application/application.types';
import type { Subject } from '#core/authorization/authorization.types';
import type { ModelIdentity, PrismaProvider } from '#core/database/database.types';

export type AuthSession = {
    readonly user: Readonly<Record<string, unknown> & { id: string }>;
    readonly session: Readonly<Record<string, unknown> & { id: string; userId: string; expiresAt: Date }>;
};
/** Assurance of the current login session. A configured factor is not assurance until a challenge succeeds. */
export type AssuranceLevel = 'single-factor' | 'two-factor';
export type AssuranceMethod = 'totp' | 'recovery';
export type SessionAssurance = {
    readonly level: AssuranceLevel;
    /** Whether the user has an active (confirmed) second factor. */
    readonly configured: boolean;
    readonly method?: AssuranceMethod;
    readonly verifiedAt?: Date;
    readonly expiresAt?: Date;
};
export type TwoFactorEnrollment = { readonly secret: string; readonly otpauthUri: string };
export type TwoFactorGrant = {
    readonly assurance: SessionAssurance;
    /** Plaintext recovery codes exist only in the issuing response. */
    readonly recoveryCodes?: readonly string[];
    /** Unused recovery codes left after a recovery-code challenge. */
    readonly recoveryCodesRemaining?: number;
};
/** Framework-owned second-factor state and challenges, keyed by the Better Auth session. */
export type TwoFactorService = {
    assurance(session: AuthSession): Promise<SessionAssurance>;
    beginEnrollment(session: AuthSession): Promise<TwoFactorEnrollment>;
    confirmEnrollment(session: AuthSession, code: string, ttlSeconds: number): Promise<TwoFactorGrant>;
    verifyTotp(session: AuthSession, code: string, ttlSeconds: number): Promise<TwoFactorGrant>;
    verifyRecovery(session: AuthSession, code: string, ttlSeconds: number): Promise<TwoFactorGrant>;
    regenerateRecoveryCodes(session: AuthSession): Promise<readonly string[]>;
};
export type Authentication = {
    readonly twoFactor: TwoFactorService;
    readonly basePath: '/api/auth';
    handle(request: Request): Promise<Response>;
    getSession(request: Request): Promise<AuthSession | null>;
    resolveSubject(request: Request): Promise<Subject>;
};
export type AuthenticationDefinition = {
    readonly kind: 'better-auth';
    readonly database: string;
    readonly protectedModels: readonly ModelIdentity[];
    createApp(provider: PrismaProvider): AppDefinition;
    initialize(application: Application): Promise<Authentication>;
};
