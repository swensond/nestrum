import { describe, expect, it } from 'vitest';
import {
    API_KEY_SUBJECT_TYPE,
    ApiKeyError,
    apiKeySubject,
    isApiKeyScope,
    MAX_API_KEY_SCOPES,
    parseApiKeyScopes,
    requiredApiScope,
    scopesSatisfy,
} from '../src/index.js';

describe('API-key scopes', () => {
    it('accepts resource:action scopes and a per-resource wildcard only', () => {
        for (const scope of ['projects:read', 'events:write', 'audit-logs:export', 'a:b_c', 'projects:*']) {
            expect(isApiKeyScope(scope), scope).toBe(true);
        }
        for (const scope of [
            '',
            'projects',
            ':read',
            'Projects:read',
            'projects:Read',
            '*',
            '*:*',
            'a:b:c',
            'projects: read',
            'projects:',
            5,
            null,
        ]) {
            expect(isApiKeyScope(scope), String(scope)).toBe(false);
        }
    });

    it('validates, deduplicates and sorts caller-supplied scopes, rejecting rather than repairing', () => {
        expect(parseApiKeyScopes(['b:x', 'a:y', 'b:x'])).toEqual(['a:y', 'b:x']);
        expect(parseApiKeyScopes([])).toEqual([]);
        for (const bad of [
            null,
            'a:b',
            ['a:b', 'Bad'],
            [1],
            Array.from({ length: MAX_API_KEY_SCOPES + 1 }, (_, i) => `r${i}:a`),
        ]) {
            expect(() => parseApiKeyScopes(bad)).toThrow(
                expect.objectContaining({ code: 'API_KEY_SCOPES_INVALID', status: 400 }),
            );
        }
    });

    it('grants by exact scope or the same prefix wildcard and fails closed otherwise', () => {
        expect(scopesSatisfy(['projects:read'], 'projects:read')).toBe(true);
        expect(scopesSatisfy(['projects:*'], 'projects:write')).toBe(true);
        expect(scopesSatisfy(['projects:read'], 'projects:write')).toBe(false);
        expect(scopesSatisfy(['events:*'], 'projects:read')).toBe(false);
        // Wildcards never widen across resources, and malformed grants or requirements never match.
        expect(scopesSatisfy(['*'], 'projects:read')).toBe(false);
        expect(scopesSatisfy(['projects:read'], 'projects:*')).toBe(false);
        expect(scopesSatisfy(['projects:*'], 'projects:*')).toBe(false);
        expect(scopesSatisfy(['PROJECTS:READ'], 'projects:read')).toBe(false);
        expect(scopesSatisfy(['projects:read'], 'nonsense')).toBe(false);
        expect(scopesSatisfy('projects:read', 'projects:read')).toBe(false);
        expect(scopesSatisfy(undefined, 'projects:read')).toBe(false);
        expect(scopesSatisfy([{ toString: () => 'projects:read' }], 'projects:read')).toBe(false);
    });

    it('derives the default required scope from the resource slug and operation, honoring overrides', () => {
        const resource = {
            model: 'BlogPost',
            apiAccess: { auth: ['api-key'] as const, scopes: { create: 'posts:create' } },
        };
        expect(requiredApiScope(resource, 'list')).toBe('blog-posts:read');
        expect(requiredApiScope(resource, 'retrieve')).toBe('blog-posts:read');
        expect(requiredApiScope(resource, 'update')).toBe('blog-posts:write');
        expect(requiredApiScope(resource, 'delete')).toBe('blog-posts:write');
        expect(requiredApiScope(resource, 'create')).toBe('posts:create');
    });
});

describe('API-key subjects and errors', () => {
    it('builds an explicit, frozen subject with no role and only valid scopes', () => {
        const subject = apiKeySubject({
            id: 'key_1',
            name: 'CI',
            owner: { type: 'user', id: 'u1' },
            scopes: ['projects:read', 'not a scope'],
        });
        expect(subject).toEqual({
            id: 'key_1',
            anonymous: false,
            type: API_KEY_SUBJECT_TYPE,
            owner: { type: 'user', id: 'u1' },
            scopes: ['projects:read'],
        });
        expect(subject).not.toHaveProperty('role');
        expect(Object.isFrozen(subject)).toBe(true);
        expect(Object.isFrozen(subject.scopes)).toBe(true);
        expect(Object.isFrozen(subject.owner)).toBe(true);
    });

    it('marks authentication failures 401 with the credential challenge', () => {
        const error = ApiKeyError.unauthenticated('API_KEY_INVALID', 'The API key is not valid.');
        expect(error).toMatchObject({
            status: 401,
            code: 'API_KEY_INVALID',
            headers: { 'WWW-Authenticate': 'X-API-Key' },
        });
    });
});
