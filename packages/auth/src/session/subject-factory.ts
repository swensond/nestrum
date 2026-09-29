import { z } from 'zod';
import { AppError, snapshotQueryValue } from '@nestrum/core';
import type { AuthSession, Subject } from '@nestrum/core';

const SESSION_SCHEMA = z.object({ user: z.object({ id: z.string().min(1) }).passthrough(),
    session: z.object({ id: z.string().min(1), userId: z.string().min(1), expiresAt: z.date() }).passthrough() });

export type SubjectMapper = (session: AuthSession) => Subject | Promise<Subject>;

export class SubjectFactory {
    constructor(private readonly map: SubjectMapper = ({ user }) => ({ id: user.id, anonymous: false })) {}

    async create(value: AuthSession | null): Promise<Subject> {
        if (value === null) { return Object.freeze({ anonymous: true }); }
        const parsed = SESSION_SCHEMA.safeParse(value);
        if (!parsed.success || parsed.data.user.id !== parsed.data.session.userId) {
            throw new AppError('AUTH_SESSION_INVALID', 'Authentication returned an invalid session.');
        }
        if (parsed.data.session.expiresAt.getTime() <= Date.now()) { return Object.freeze({ anonymous: true }); }
        const subject = await this.map(snapshotQueryValue(parsed.data));
        if (!subject || typeof subject !== 'object' || Array.isArray(subject) || ![Object.prototype, null].includes(Object.getPrototypeOf(subject) as object | null)) {
            throw new AppError('AUTH_SUBJECT_INVALID', 'Subject factories must return an attribute record.');
        }

        return Object.freeze(snapshotQueryValue(subject));
    }
}
