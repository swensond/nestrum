import type {
    AssuranceMethod,
    AuthSession,
    PrismaProvider,
    QueryBackend,
    SessionAssurance,
    TwoFactorEnrollment,
    TwoFactorGrant,
    TwoFactorService,
} from '@nestrum/core';
import { AppError } from '@nestrum/core';
import type { AuthPrismaBinding } from '#auth/adapter/prisma-adapter';
import { authQueryBackend } from '#auth/adapter/prisma-adapter';
import { createTwoFactorKeys, generateRecoveryCode, isRecoveryCodeShape, RECOVERY_CODE_COUNT } from './crypto.js';
import { generateTotpSecret, matchTotp, otpauthUri } from './totp.js';

/** Consecutive failed challenge attempts before a factor locks. */
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_SECONDS = 300;
const CAS_RETRIES = 5;

type Row = Record<string, unknown>;

export type TwoFactorServiceOptions = {
    readonly binding: AuthPrismaBinding;
    readonly provider: PrismaProvider;
    readonly secret: string;
    readonly issuer: string;
    /** Injectable clock (milliseconds since the epoch) for deterministic tests. */
    readonly now?: () => number;
};

function fail(code: string, message: string, status: number): never {
    throw new AppError(code, message, status);
}

export function createTwoFactorService(options: TwoFactorServiceOptions): TwoFactorService {
    const clock = options.now ?? Date.now;
    const keys = createTwoFactorKeys(options.secret);
    const mongo = options.provider === 'mongodb';
    const factors = authQueryBackend(options.binding, options.provider, 'TwoFactorFactor');
    const recoveryCodes = authQueryBackend(options.binding, options.provider, 'TwoFactorRecoveryCode');
    const assurances = authQueryBackend(options.binding, options.provider, 'AdminAssurance');

    const stored = (ms: number): Date | string => (mongo ? new Date(ms) : new Date(ms).toISOString());
    const read = (value: unknown): number | undefined =>
        value === null || value === undefined ? undefined : new Date(value as string | Date).getTime();
    const where = (filter: object) => ({ filters: [filter], orderBy: [] });
    const first = async (backend: QueryBackend, filter: object): Promise<Row | undefined> =>
        (await backend.all({ ...where(filter), limit: 1 }))[0] as Row | undefined;

    async function factorOf(session: AuthSession): Promise<Row | undefined> {
        return first(factors, { userId: session.user.id });
    }
    const confirmed = (factor: Row | undefined): boolean => factor !== undefined && factor.confirmedAt != null;

    function assertUnlocked(factor: Row): void {
        const until = read(factor.lockedUntil);
        if (until !== undefined && until > clock()) {
            fail('TWO_FACTOR_LOCKED', 'Too many failed attempts. Try again later.', 429);
        }
    }

    /** Counts a failed attempt with compare-and-swap so concurrent guesses cannot skip the counter. */
    async function recordFailure(factor: Row): Promise<never> {
        let current: Row | undefined = factor;
        for (let attempt = 0; attempt < CAS_RETRIES && current; attempt += 1) {
            const failures = Number(current.failedAttempts ?? 0) + 1;
            const lock = failures >= MAX_FAILED_ATTEMPTS;
            const changed = await factors.update(where({ id: current.id, failedAttempts: current.failedAttempts }), {
                failedAttempts: lock ? 0 : failures,
                lockedUntil: lock ? stored(clock() + LOCKOUT_SECONDS * 1000) : null,
                updatedAt: stored(clock()),
            });
            if (changed === 1) {
                if (lock) {
                    fail('TWO_FACTOR_LOCKED', 'Too many failed attempts. Try again later.', 429);
                }
                break;
            }
            current = await first(factors, { id: factor.id });
        }

        return fail('TWO_FACTOR_INVALID_CODE', 'The verification code is not valid.', 400);
    }

    async function grant(session: AuthSession, method: AssuranceMethod, ttlSeconds: number): Promise<SessionAssurance> {
        if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
            throw new AppError('TWO_FACTOR_CONFIG_INVALID', 'Assurance TTL must be a positive integer.');
        }
        const now = clock();
        const expiresAt = now + ttlSeconds * 1000;
        // Prune this user's stale rows (sessions removed without a cascade) and replace this session's row.
        for (const row of await assurances.all(where({ userId: session.user.id }))) {
            const record = row as Row;
            if (record.sessionId === session.session.id || (read(record.expiresAt) ?? 0) <= now) {
                await assurances.delete(where({ id: record.id }));
            }
        }
        await assurances.create({
            id: crypto.randomUUID(),
            sessionId: session.session.id,
            userId: session.user.id,
            method,
            verifiedAt: stored(now),
            expiresAt: stored(expiresAt),
            createdAt: stored(now),
        });

        return {
            level: 'two-factor',
            configured: true,
            method,
            verifiedAt: new Date(now),
            expiresAt: new Date(expiresAt),
        };
    }

    /** Replaces the whole set. A failure part-way leaves fewer codes, never a still-valid old set. */
    async function issueRecoveryCodes(userId: string): Promise<string[]> {
        await recoveryCodes.delete(where({ userId }));
        const now = stored(clock());
        const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
        for (const code of codes) {
            await recoveryCodes.create({
                id: crypto.randomUUID(),
                userId,
                codeHash: keys.hashRecoveryCode(code),
                usedAt: null,
                createdAt: now,
            });
        }

        return codes;
    }

    /** Verifies a TOTP with lockout and single-use time steps; resolves only on success. */
    async function checkTotp(factor: Row, code: string): Promise<void> {
        assertUnlocked(factor);
        let step: number | undefined;
        try {
            step = matchTotp(keys.decrypt(String(factor.secret)), code, clock());
        } catch {
            throw new AppError('TWO_FACTOR_STORAGE_INVALID', 'Stored second-factor secret cannot be read.');
        }
        const last = factor.lastUsedStep == null ? undefined : Number(factor.lastUsedStep);
        if (step === undefined || (last !== undefined && step <= last)) {
            await recordFailure(factor);
        }
        const claimed = await factors.update(where({ id: factor.id, lastUsedStep: factor.lastUsedStep ?? null }), {
            lastUsedStep: step,
            failedAttempts: 0,
            lockedUntil: null,
            updatedAt: stored(clock()),
        });
        if (claimed !== 1) {
            await recordFailure(factor);
        }
    }

    const notConfigured = () => fail('TWO_FACTOR_NOT_CONFIGURED', 'Two-factor authentication is not configured.', 409);
    const notStarted = () => fail('TWO_FACTOR_ENROLLMENT_NOT_STARTED', 'Start two-factor enrollment first.', 409);

    return Object.freeze({
        async assurance(session: AuthSession): Promise<SessionAssurance> {
            if (!confirmed(await factorOf(session))) {
                return { level: 'single-factor', configured: false };
            }
            const row = await first(assurances, { sessionId: session.session.id });
            const expiresAt = read(row?.expiresAt);
            if (!row || row.userId !== session.user.id || expiresAt === undefined || expiresAt <= clock()) {
                return { level: 'single-factor', configured: true };
            }
            const verifiedAt = read(row.verifiedAt);

            return {
                level: 'two-factor',
                configured: true,
                method: row.method as AssuranceMethod,
                ...(verifiedAt === undefined ? {} : { verifiedAt: new Date(verifiedAt) }),
                expiresAt: new Date(expiresAt),
            };
        },

        async beginEnrollment(session: AuthSession): Promise<TwoFactorEnrollment> {
            const existing = await factorOf(session);
            if (confirmed(existing)) {
                fail('TWO_FACTOR_ALREADY_CONFIGURED', 'Two-factor authentication is already configured.', 409);
            }
            if (existing) {
                assertUnlocked(existing);
                await factors.delete(where({ id: existing.id, confirmedAt: null }));
            }
            const secret = generateTotpSecret();
            const now = stored(clock());
            await factors.create({
                id: crypto.randomUUID(),
                userId: session.user.id,
                type: 'totp',
                secret: keys.encrypt(secret),
                confirmedAt: null,
                lastUsedStep: null,
                failedAttempts: 0,
                lockedUntil: null,
                createdAt: now,
                updatedAt: now,
            });
            const account = typeof session.user.email === 'string' ? session.user.email : session.user.id;

            return { secret, otpauthUri: otpauthUri(secret, options.issuer, account) };
        },

        async confirmEnrollment(session, code, ttlSeconds): Promise<TwoFactorGrant> {
            const factor = await factorOf(session);
            if (!factor || confirmed(factor)) {
                return notStarted();
            }
            await checkTotp(factor, code);
            const activated = await factors.update(where({ id: factor.id, confirmedAt: null }), {
                confirmedAt: stored(clock()),
                updatedAt: stored(clock()),
            });
            if (activated !== 1) {
                return notStarted();
            }
            const codes = await issueRecoveryCodes(session.user.id);

            return {
                assurance: await grant(session, 'totp', ttlSeconds),
                recoveryCodes: codes,
                recoveryCodesRemaining: codes.length,
            };
        },

        async verifyTotp(session, code, ttlSeconds): Promise<TwoFactorGrant> {
            const factor = await factorOf(session);
            if (!factor || !confirmed(factor)) {
                return notConfigured();
            }
            await checkTotp(factor, code);

            return { assurance: await grant(session, 'totp', ttlSeconds) };
        },

        async verifyRecovery(session, code, ttlSeconds): Promise<TwoFactorGrant> {
            const factor = await factorOf(session);
            if (!factor || !confirmed(factor)) {
                return notConfigured();
            }
            assertUnlocked(factor);
            const row = isRecoveryCodeShape(code)
                ? await first(recoveryCodes, {
                      userId: session.user.id,
                      codeHash: keys.hashRecoveryCode(code),
                      usedAt: null,
                  })
                : undefined;
            const claimed = row
                ? await recoveryCodes.update(where({ id: row.id, usedAt: null }), { usedAt: stored(clock()) })
                : 0;
            if (claimed !== 1) {
                await recordFailure(factor);
            }
            await factors.update(where({ id: factor.id }), { failedAttempts: 0, lockedUntil: null });
            const remaining = await recoveryCodes.count(where({ userId: session.user.id, usedAt: null }));

            return { assurance: await grant(session, 'recovery', ttlSeconds), recoveryCodesRemaining: remaining };
        },

        async regenerateRecoveryCodes(session): Promise<readonly string[]> {
            if (!confirmed(await factorOf(session))) {
                return notConfigured();
            }

            return issueRecoveryCodes(session.user.id);
        },
    });
}
