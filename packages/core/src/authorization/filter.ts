import { PolicyError } from './authorization.errors.js';

export type FilterValue = string | number | bigint | boolean | null | Date;
export type FilterExpression =
    { readonly kind: 'eq' | 'neq'; readonly field: string; readonly value: FilterValue } |
    { readonly kind: 'in' | 'notIn'; readonly field: string; readonly values: readonly FilterValue[] } |
    { readonly kind: 'isNull'; readonly field: string } |
    { readonly kind: 'and' | 'or'; readonly expressions: readonly FilterExpression[] } |
    { readonly kind: 'not'; readonly expression: FilterExpression };

function fieldName(field: string): string {
    if (typeof field !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(field) || ['AND', 'OR', 'NOT', '__proto__', 'constructor', 'prototype'].includes(field)) {
        throw new PolicyError('POLICY_SCOPE_INVALID', 'Policy filters require a scalar model field name.');
    }

    return field;
}

function valueCopy(value: FilterValue): FilterValue {
    if (value instanceof Date && Number.isFinite(value.getTime())) {
        return new Date(value.getTime());
    }
    if (value === null || ['string', 'boolean', 'bigint'].includes(typeof value) || (typeof value === 'number' && Number.isFinite(value))) {
        return value;
    }
    throw new PolicyError('POLICY_SCOPE_INVALID', 'Policy filter values must be finite scalars, valid dates, or null.');
}

export function eq(field: string, value: FilterValue): FilterExpression {
    return Object.freeze({ kind: 'eq', field: fieldName(field), value: valueCopy(value) });
}
export function neq(field: string, value: FilterValue): FilterExpression {
    return Object.freeze({ kind: 'neq', field: fieldName(field), value: valueCopy(value) });
}
export function inFilter(field: string, values: readonly FilterValue[]): FilterExpression {
    if (!Array.isArray(values)) { throw new PolicyError('POLICY_SCOPE_INVALID', 'Policy membership filters require an array.'); }

    return Object.freeze({ kind: 'in', field: fieldName(field), values: Object.freeze(values.map(valueCopy)) });
}
export function notIn(field: string, values: readonly FilterValue[]): FilterExpression {
    if (!Array.isArray(values)) { throw new PolicyError('POLICY_SCOPE_INVALID', 'Policy membership filters require an array.'); }

    return Object.freeze({ kind: 'notIn', field: fieldName(field), values: Object.freeze(values.map(valueCopy)) });
}
export function isNull(field: string): FilterExpression {
    return Object.freeze({ kind: 'isNull', field: fieldName(field) });
}
export function and(...expressions: readonly FilterExpression[]): FilterExpression {
    if (!expressions.length) { throw new PolicyError('POLICY_SCOPE_INVALID', 'Policy conjunctions require at least one expression.'); }

    return Object.freeze({ kind: 'and', expressions: Object.freeze([...expressions]) });
}
export function or(...expressions: readonly FilterExpression[]): FilterExpression {
    if (!expressions.length) { throw new PolicyError('POLICY_SCOPE_INVALID', 'Policy disjunctions require at least one expression.'); }

    return Object.freeze({ kind: 'or', expressions: Object.freeze([...expressions]) });
}
export function not(expression: FilterExpression): FilterExpression {
    return Object.freeze({ kind: 'not', expression });
}

/** Compile without using schema transforms that could broaden a policy predicate. */
export function compilePolicyScope(expression: FilterExpression, fields: readonly string[], ancestors = new Set<object>()): object {
    if (!expression || typeof expression !== 'object' || ancestors.has(expression)) {
        throw new PolicyError('POLICY_SCOPE_INVALID', 'Policy scope must be an acyclic filter expression.');
    }
    ancestors.add(expression);
    try {
        if (expression.kind === 'and' || expression.kind === 'or') {
            if (!Array.isArray(expression.expressions) || !expression.expressions.length) {
                throw new PolicyError('POLICY_SCOPE_INVALID', 'Policy logical filters cannot be empty.');
            }

            return { [expression.kind === 'and' ? 'AND' : 'OR']: expression.expressions.map((entry) => compilePolicyScope(entry, fields, ancestors)) };
        }
        if (expression.kind === 'not') {
            return { NOT: compilePolicyScope(expression.expression, fields, ancestors) };
        }
        if (!['eq', 'neq', 'in', 'notIn', 'isNull'].includes(expression.kind) || !('field' in expression) || !fields.includes(fieldName(expression.field))) {
            throw new PolicyError('POLICY_SCOPE_INVALID', 'Policy filter references an unsupported or unknown scalar field.');
        }
        switch (expression.kind) {
            case 'eq': return { [expression.field]: { equals: valueCopy(expression.value) } };
            case 'neq': return { [expression.field]: { not: valueCopy(expression.value) } };
            case 'isNull': return { [expression.field]: { equals: null } };
            case 'in': case 'notIn': {
                if (!Array.isArray(expression.values)) { throw new PolicyError('POLICY_SCOPE_INVALID', 'Policy membership filters require an array.'); }

                return { [expression.field]: { [expression.kind]: expression.values.map(valueCopy) } };
            }
            default: throw new PolicyError('POLICY_SCOPE_INVALID', 'Unknown policy filter expression.');
        }
    } finally {
        ancestors.delete(expression);
    }
}
