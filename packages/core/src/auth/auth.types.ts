import type { Application } from '#core/application/application';
import type { AppDefinition } from '#core/application/application.types';
import type { ModelIdentity, PrismaProvider } from '#core/database/database.types';
import type { Subject } from '#core/authorization/authorization.types';

export type AuthSession = {
    readonly user: Readonly<Record<string, unknown> & { id: string }>;
    readonly session: Readonly<Record<string, unknown> & { id: string; userId: string; expiresAt: Date }>;
};
export type Authentication = {
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
