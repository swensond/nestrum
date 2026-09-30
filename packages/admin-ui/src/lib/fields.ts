import type { AdminFieldMetadata, AdminResourceMetadata } from '@nestrum/admin';
import type { AdminRecord, FieldErrors } from './crud.js';

export type FormMode = 'create' | 'update';
export type ValueMode = 'value' | 'omit' | 'null';
export type FormFeedback = {
    message: string;
    fields: FieldErrors;
    values: Record<string, string>;
    modes: Record<string, ValueMode>;
};
export type FieldWidget =
    | 'text'
    | 'textarea'
    | 'number'
    | 'boolean'
    | 'enum'
    | 'date'
    | 'datetime-local'
    | 'time'
    | 'readonly';

export function writable(field: AdminFieldMetadata, mode: FormMode): boolean {
    return !field.readOnly && (mode === 'create' ? field.creatable : field.updatable && !field.primaryKey);
}

export function fieldWidget(field: AdminFieldMetadata, mode: FormMode): FieldWidget {
    if (!writable(field, mode)) {
        return 'readonly';
    }
    if (field.array) {
        return 'textarea';
    }
    if (field.enumValues.length) {
        return 'enum';
    }
    switch (field.kind) {
        case 'boolean':
            return 'boolean';
        case 'integer':
        case 'number':
            return 'number';
        case 'date-string':
        case 'temporal-date':
            return 'date';
        case 'date':
        case 'datetime-string':
        case 'temporal-instant':
        case 'temporal-datetime':
            return 'datetime-local';
        case 'temporal-time':
            return 'time';
        case 'string':
            return /description|content|notes|body/i.test(field.name) ? 'textarea' : 'text';
        default:
            return 'text';
    }
}

export function displayValue(value: unknown): string {
    if (value === undefined) {
        return '—';
    }
    if (value === null) {
        return 'null';
    }
    if (typeof value === 'object') {
        return JSON.stringify(value);
    }

    return String(value);
}

export function inputValue(field: AdminFieldMetadata, value: unknown): string {
    if (value === undefined || value === null) {
        return '';
    }
    if (field.array) {
        return JSON.stringify(value);
    }
    const text = String(value);
    if (['date', 'temporal-instant', 'datetime-string'].includes(field.kind)) {
        const date = new Date(text);
        return Number.isNaN(date.getTime()) ? text : date.toISOString().slice(0, -1);
    }

    return text;
}

export function initialValueMode(field: AdminFieldMetadata, mode: FormMode, value: unknown): ValueMode {
    if (mode === 'update') {
        return 'omit';
    }
    if (value === null && field.nullable) {
        return 'null';
    }
    if (value === undefined && !field.required) {
        return 'omit';
    }

    return 'value';
}

function scalar(field: AdminFieldMetadata, value: string): unknown {
    switch (field.kind) {
        case 'integer':
        case 'number': {
            if (
                !value.trim() ||
                !Number.isFinite(Number(value)) ||
                (field.kind === 'integer' && !Number.isSafeInteger(Number(value)))
            ) {
                throw new Error('Enter a valid number.');
            }
            return Number(value);
        }
        case 'boolean': {
            if (!['true', 'false'].includes(value)) {
                throw new Error('Choose true or false.');
            }
            return value === 'true';
        }
        case 'bigint': {
            if (!/^-?(0|[1-9][0-9]*)$/.test(value)) {
                throw new Error('Enter a whole number.');
            }
            return value;
        }
        case 'date':
        case 'temporal-instant':
        case 'datetime-string': {
            if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value)) {
                throw new Error('Enter a valid date and time.');
            }
            const date = new Date(`${value}Z`);
            if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 16) !== value.slice(0, 16)) {
                throw new Error('Enter a valid date and time.');
            }
            return date.toISOString();
        }
        case 'temporal-datetime':
        case 'temporal-time':
            return (/^\d{4}-/.test(value) && value.length === 16) ||
                (field.kind === 'temporal-time' && value.length === 5)
                ? `${value}:00`
                : value;
        default:
            return value;
    }
}

export function parseResourceForm(
    resource: AdminResourceMetadata,
    mode: FormMode,
    data: FormData,
): { body: AdminRecord; feedback: FormFeedback } {
    const entries: [string, unknown][] = [];
    const feedback: FormFeedback = { message: '', fields: {}, values: {}, modes: {} };
    const allowed = new Set(
        resource.fields.filter((field) => writable(field, mode)).flatMap((field) => [field.name, `mode:${field.name}`]),
    );
    if (
        [...data.keys()].some((name) => !allowed.has(name)) ||
        [...allowed].some((name) => data.getAll(name).length > 1)
    ) {
        feedback.message = 'The form contains unexpected fields. Reload and try again.';
    }
    for (const field of resource.fields.filter((candidate) => writable(candidate, mode))) {
        const raw = data.get(field.name);
        const value = typeof raw === 'string' ? raw : '';
        const selection =
            data.get(`mode:${field.name}`) ??
            (raw === null && (mode === 'update' || !field.required) ? 'omit' : 'value');
        const valueMode: ValueMode = selection === 'omit' || selection === 'null' ? selection : 'value';
        Object.defineProperty(feedback.values, field.name, { value, enumerable: true, configurable: true });
        Object.defineProperty(feedback.modes, field.name, { value: valueMode, enumerable: true, configurable: true });
        try {
            if (!['omit', 'null', 'value'].includes(String(selection)) || raw instanceof File) {
                throw new Error('Invalid field input.');
            }
            if (valueMode === 'omit') {
                if (mode === 'create' && field.required) {
                    throw new Error('This field is required.');
                }
                continue;
            }
            if (valueMode === 'null') {
                if (!field.nullable) {
                    throw new Error('This field cannot be null.');
                }
                entries.push([field.name, null]);
                continue;
            }
            if (raw === null) {
                throw new Error('Enter a value or choose to leave this field unchanged.');
            }
            if (field.array) {
                const array: unknown = JSON.parse(value);
                if (!Array.isArray(array)) {
                    throw new Error('Enter a JSON array.');
                }
                entries.push([field.name, array]);
            } else {
                entries.push([field.name, scalar(field, value)]);
            }
        } catch (error) {
            Object.defineProperty(feedback.fields, field.name, {
                value: [
                    error instanceof SyntaxError
                        ? 'Enter a valid JSON array.'
                        : error instanceof Error
                          ? error.message
                          : 'Invalid value.',
                ],
                enumerable: true,
                configurable: true,
            });
        }
    }
    if (Object.keys(feedback.fields).length && !feedback.message) {
        feedback.message = 'Check the highlighted fields and try again.';
    }
    if (mode === 'update' && !entries.length && !feedback.message) {
        feedback.message = 'Choose at least one field to update.';
    }

    return { body: Object.fromEntries(entries), feedback };
}
