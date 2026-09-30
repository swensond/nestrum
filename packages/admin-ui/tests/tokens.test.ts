import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cssPath, readTokens, renderTokensCss } from '../tooling/tokens.mjs';

type ColorToken = { name: string; value: string | Record<string, string> };

const tokens = readTokens();
const colors = new Map<string, ColorToken>(tokens.color.tokens.map((token: ColorToken) => [token.name, token]));
const themes: string[] = tokens.color.themes.map((theme: { id: string }) => theme.id);

function hex(name: string, theme: string): string {
    const token = colors.get(name);
    if (!token) throw new Error(`Unknown color token ${name}`);
    return typeof token.value === 'string' ? token.value : (token.value[theme] ?? '');
}

function luminance(value: string): number {
    const channels = [1, 3, 5].map((start) => Number.parseInt(value.slice(start, start + 2), 16) / 255);
    const [r = 0, g = 0, b = 0] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
    const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a) as [number, number];
    return (light + 0.05) / (dark + 0.05);
}

// The pairings documented in docs/design-system/accessibility.md.
const pairs: Array<[foreground: string, backgrounds: string[], minimum: number]> = [
    ['ink', ['canvas', 'surface', 'surface-subtle', 'input', 'violet-soft'], 4.5],
    ['ink-muted', ['canvas', 'surface', 'surface-subtle', 'input'], 4.5],
    ['nav-ink', ['canvas', 'surface-subtle'], 4.5],
    ['nav-ink-muted', ['canvas'], 4.5],
    ['nav-active-ink', ['nav-active'], 4.5],
    ['on-violet', ['violet'], 4.5],
    ['violet-ink', ['surface', 'violet-soft'], 4.5],
    ['danger', ['surface', 'input', 'danger-soft'], 4.5],
    ['success-ink', ['success-soft', 'surface'], 4.5],
    ['control', ['input', 'surface', 'surface-subtle'], 3],
    ['focus', ['canvas', 'surface', 'input'], 3],
];

describe('admin design tokens', () => {
    it('keeps tokens.css generated from tokens.json', () => {
        expect(readFileSync(cssPath, 'utf8')).toBe(renderTokensCss(tokens));
    });

    it('defines every color in every theme', () => {
        for (const token of colors.values()) {
            for (const theme of themes) {
                expect(hex(token.name, theme), `${token.name} (${theme})`).toMatch(/^#[0-9a-f]{6}$/);
            }
        }
    });

    it.each(themes)('meets the documented contrast minimums in the %s theme', (theme) => {
        for (const [foreground, backgrounds, minimum] of pairs) {
            for (const background of backgrounds) {
                const ratio = contrast(hex(foreground, theme), hex(background, theme));
                expect(ratio, `${foreground} on ${background}`).toBeGreaterThanOrEqual(minimum);
            }
        }
    });
});
