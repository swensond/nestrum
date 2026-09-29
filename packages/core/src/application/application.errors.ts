import type { AppHookName } from './application.types.js';

export class AppError extends Error {
    constructor(public readonly code: string, message: string, public readonly status: number = 500, options?: ErrorOptions) {
        super(message, options);
        this.name = 'AppError';
    }
}

export class AppRegistryError extends AppError {
    constructor(code: 'INVALID_APP_NAME' | 'INVALID_PRISMA_CONTRIBUTION' | 'DUPLICATE_APP' | 'MISSING_APP_DEPENDENCY' | 'APP_DEPENDENCY_CYCLE' | 'APP_NOT_FOUND', message: string) {
        super(code, message);
        this.name = 'AppRegistryError';
    }
}

export class AppLifecycleError extends AppError {
    constructor(public readonly appName: string, public readonly hook: AppHookName, cause: unknown) {
        super('APP_HOOK_FAILED', `App "${appName}" failed during ${hook}().`, 500, { cause });
        this.name = 'AppLifecycleError';
    }
}
