import { AppError } from '@nestrum/core';

export class PrismaContractError extends AppError {
    constructor(
        code:
            | 'PRISMA_DATABASE_UNKNOWN'
            | 'PRISMA_FRAGMENT_READ_FAILED'
            | 'PRISMA_FRAGMENT_PATH_INVALID'
            | 'PRISMA_FRAGMENTS_EMPTY'
            | 'PRISMA_FRAGMENT_DUPLICATE'
            | 'PRISMA_EMIT_FAILED'
            | 'PRISMA_OUTPUT_FAILED',
        message: string,
        options?: ErrorOptions,
    ) {
        super(code, message, 500, options);
        this.name = 'PrismaContractError';
    }
}
