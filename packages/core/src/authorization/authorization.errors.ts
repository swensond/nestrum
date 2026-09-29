import { AppError } from '#core/application/application.errors';

export class AuthorizationError extends AppError {
    constructor(public readonly reason: string, options?: ErrorOptions) {
        super('AUTHORIZATION_DENIED', `Authorization denied: ${reason}.`, 403, options);
        this.name = 'AuthorizationError';
    }
}

export class PolicyError extends AppError {
    constructor(code: 'POLICY_INVALID' | 'POLICY_DUPLICATE' | 'POLICY_SCOPE_INVALID', message: string, options?: ErrorOptions) {
        super(code, message, 500, options);
        this.name = 'PolicyError';
    }
}
