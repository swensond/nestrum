import { describe, expect, it } from 'vitest';
import { FRAMEWORK_NAME } from '../src/index.js';

describe('@nestrum/core workspace smoke test', () => {
    it('loads the TypeScript ESM entry point', () => {
        expect(FRAMEWORK_NAME).toBe('Nestrum');
    });
});
