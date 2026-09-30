import { AdminTwoFactorRequiredError, AppError, AuthorizationError } from '@nestrum/core';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';

export type ErrorBody = {
    error: {
        code: string;
        message: string;
        reason?: string;
        issues?: { code: string; path: (string | number)[]; message: string }[];
    };
};
export type MappedError = {
    readonly status: ContentfulStatusCode;
    readonly body: ErrorBody;
    readonly headers?: Record<string, string | string[]>;
};

export function mapHttpError(error: unknown): MappedError {
    if (error instanceof ZodError) {
        return {
            status: 400,
            body: {
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Request validation failed.',
                    issues: error.issues.map((issue) => ({
                        code: issue.code,
                        path: issue.path.map((part) => (typeof part === 'number' ? part : String(part))),
                        message: issue.message,
                    })),
                },
            },
        };
    }
    if (error instanceof AppError) {
        const status =
            Number.isInteger(error.status) && error.status >= 400 && error.status <= 599
                ? (error.status as ContentfulStatusCode)
                : 500;

        return {
            status,
            body: {
                error: {
                    code: error.code,
                    message: status >= 500 ? 'Internal server error.' : error.message,
                    ...(error instanceof AuthorizationError || error instanceof AdminTwoFactorRequiredError
                        ? { reason: error.reason }
                        : {}),
                },
            },
        };
    }
    if (error instanceof HTTPException) {
        const status = error.status >= 400 && error.status <= 599 ? error.status : 500;
        const headers = new Headers(error.getResponse().headers);
        for (const name of [
            'content-length',
            'content-type',
            'content-encoding',
            'transfer-encoding',
            'etag',
            'content-md5',
            'digest',
        ]) {
            headers.delete(name);
        }

        const headerRecord: Record<string, string | string[]> = {};
        headers.forEach((value, name) => {
            headerRecord[name] = value;
        });
        if (headers.has('set-cookie')) {
            headerRecord['set-cookie'] = headers.getSetCookie();
        }

        return {
            status,
            headers: headerRecord,
            body: {
                error: {
                    code: 'HTTP_ERROR',
                    message: status >= 500 ? 'Internal server error.' : error.message || 'Request failed.',
                },
            },
        };
    }

    return { status: 500, body: { error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error.' } } };
}
