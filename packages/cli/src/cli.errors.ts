import { AppError } from '@nestrum/core';

export class CliError extends AppError {
    constructor(
        code:
            | 'CLI_ARGUMENT_INVALID'
            | 'CLI_CONFIG_INVALID'
            | 'CLI_CONFIG_LOAD_FAILED'
            | 'CLI_DATABASE_EMPTY'
            | 'CLI_DELEGATE_FAILED',
        message: string,
        public readonly exitCode = 1,
        options?: ErrorOptions,
    ) {
        super(code, message, 500, options);
        this.name = 'CliError';
    }
}
