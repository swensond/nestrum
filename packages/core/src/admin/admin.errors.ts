import { AppError } from '#core/application/application.errors';

const STATUS = Object.freeze({
    ADMIN_CONFIG_INVALID: 500,
    ADMIN_ROUTE_CONFLICT: 500,
    ADMIN_RESOURCE_UNKNOWN: 500,
    ADMIN_ACTION_NOT_IMPLEMENTED: 501,
    ADMIN_REGISTRATION_INVALID: 500,
    ADMIN_RESOURCE_NOT_FOUND: 404,
    ADMIN_RESOURCE_DUPLICATE: 500,
    ADMIN_FIELD_UNKNOWN: 500,
    ADMIN_ACTION_UNKNOWN: 404,
    ADMIN_ACTION_DUPLICATE: 500,
    ADMIN_ORIGIN_DENIED: 403,
    ADMIN_AUTHENTICATION_REQUIRED: 401,
});

export type AdminErrorCode = keyof typeof STATUS;

export class AdminError extends AppError {
    constructor(code: AdminErrorCode, message: string, options?: ErrorOptions) {
        super(code, message, STATUS[code], options);
        this.name = 'AdminError';
    }
}
