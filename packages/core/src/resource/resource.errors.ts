import { AppError } from '#core/application/application.errors';

export class ResourceError extends AppError {
    constructor(
        code:
            | 'RESOURCE_CONFIG_INVALID'
            | 'RESOURCE_DUPLICATE'
            | 'RESOURCE_MODEL_MISSING'
            | 'RESOURCE_MODELS_INVALID'
            | 'RESOURCE_MODELS_LOAD_FAILED'
            | 'RESOURCE_SCHEMA_FAILED'
            | 'RESOURCE_REGISTRY_NOT_READY'
            | 'RESOURCE_REGISTRY_INITIALIZED'
            | 'RESOURCE_NOT_FOUND',
        message: string,
        options?: ErrorOptions,
    ) {
        super(code, message, 500, options);
        this.name = 'ResourceError';
    }
}
