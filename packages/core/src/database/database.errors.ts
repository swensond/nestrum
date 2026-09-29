import { AppError } from '#core/application/application.errors';

export class DatabaseRegistryError extends AppError {
    constructor(code: 'INVALID_DATABASE_CONFIG' | 'INVALID_DATABASE_NAME' | 'DUPLICATE_DATABASE' | 'DEFAULT_DATABASE_REQUIRED' | 'DATABASE_NOT_FOUND' | 'INVALID_MODEL_NAME', message: string) {
        super(code, message);
        this.name = 'DatabaseRegistryError';
    }
}
