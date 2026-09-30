import { AppError } from '@nestrum/core';

export class CliError extends AppError {
    constructor(
        code:
            | 'CLI_ARGUMENT_INVALID'
            | 'CLI_AUTH_NOT_CONFIGURED'
            | 'CLI_CONFIG_INVALID'
            | 'CLI_CONFIG_LOAD_FAILED'
            | 'CLI_DATABASE_EMPTY'
            | 'CLI_DELEGATE_FAILED'
            | 'CLI_CONFIG_NOT_FOUND'
            | 'CLI_ENVIRONMENT_CONFLICT'
            | 'CLI_SERVER_OPTIONS_INVALID'
            | 'BUILD_BUNDLE_FAILED'
            | 'BUILD_VALIDATION_FAILED'
            | 'BUILD_WEB_COLLISION'
            | 'BUILD_WEB_FAILED'
            | 'BUILD_WEB_LEAK'
            | 'BUILD_NOT_FOUND'
            | 'BUILD_MANIFEST_INVALID'
            | 'BUILD_INCOMPATIBLE'
            | 'BUILD_INCOMPLETE'
            | 'BUILD_STALE'
            | 'SERVE_START_FAILED'
            | 'DEV_START_FAILED',
        message: string,
        public readonly exitCode = 1,
        options?: ErrorOptions,
    ) {
        super(code, message, 500, options);
        this.name = 'CliError';
    }
}
