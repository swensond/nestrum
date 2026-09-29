import { z } from 'zod';
import { AppError } from '@nestrum/core';

export type AuthFieldDescriptor = {
    readonly type: 'string' | 'number' | 'boolean';
    readonly required: boolean;
    readonly input: boolean;
    readonly returned: boolean;
    readonly defaultValue?: string | number | boolean;
};

export class AuthField {
    constructor(readonly descriptor: AuthFieldDescriptor) { this.descriptor = Object.freeze({ ...descriptor }); Object.freeze(this); }
    optional(): AuthField { return new AuthField({ ...this.descriptor, required: false }); }
    input(): AuthField { return new AuthField({ ...this.descriptor, input: true }); }
    hidden(): AuthField { return new AuthField({ ...this.descriptor, returned: false }); }
    default(value: string | number | boolean): AuthField {
        const schema = this.descriptor.type === 'string' ? z.string() : this.descriptor.type === 'number' ? z.number().finite() : z.boolean();
        if (!schema.safeParse(value).success) { throw new AppError('AUTH_EXTENSION_INVALID', 'Extension default does not match its field type.'); }

        return new AuthField({ ...this.descriptor, defaultValue: value });
    }
}

export const field = Object.freeze(Object.fromEntries(['string', 'number', 'boolean'].map((type) => [type, () => new AuthField({ type: type as AuthFieldDescriptor['type'], required: true, input: false, returned: true })])) as {
    string(): AuthField; number(): AuthField; boolean(): AuthField;
});

export const USER_FIELDS = ['id', 'name', 'email', 'emailVerified', 'image', 'createdAt', 'updatedAt'] as const;

export function userExtensions(input: Readonly<Record<string, AuthField>> = {}): Readonly<Record<string, AuthFieldDescriptor>> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) { throw new AppError('AUTH_EXTENSION_INVALID', 'User extensions must be a field map.'); }
    const extensions: Record<string, AuthFieldDescriptor> = Object.create(null) as Record<string, AuthFieldDescriptor>;
    for (const [name, value] of Object.entries(input)) {
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name) || [...USER_FIELDS, 'constructor', 'prototype', '__proto__'].includes(name) || !(value instanceof AuthField) ||
            !['string', 'number', 'boolean'].includes(value.descriptor.type) || value.descriptor.required && !value.descriptor.input && value.descriptor.defaultValue === undefined) {
            throw new AppError('AUTH_EXTENSION_INVALID', `Invalid or reserved user extension ${name}. Required server-owned fields need a default.`);
        }
        extensions[name] = value.descriptor;
    }

    return Object.freeze(extensions);
}
