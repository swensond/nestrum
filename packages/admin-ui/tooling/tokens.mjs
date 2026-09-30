import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const tokensPath = fileURLToPath(new URL('../src/lib/theme/tokens.json', import.meta.url));
export const cssPath = fileURLToPath(new URL('../src/lib/theme/tokens.css', import.meta.url));

/**
 * @typedef {{ name: string, value: string | Record<string, string>, usage?: string }} Token
 * @typedef {{ tokens: Token[] }} TokenFamily
 * @typedef {{ name: string, fontSize: string, lineHeight: string, fontWeight: number | string, family?: string }} TypeStyle
 * @typedef {{
 *     color: TokenFamily & { themes: Array<{ id: string, name: string }> },
 *     type: { families: Record<string, string>, groups: Array<{ name: string, family: string, styles: TypeStyle[] }> },
 *     spacing?: TokenFamily, radius?: TokenFamily, size?: TokenFamily, shadow?: TokenFamily
 * }} Tokens
 */

/** @returns {Tokens} */
export function readTokens() {
    return JSON.parse(readFileSync(tokensPath, 'utf8'));
}

/**
 * @param {Array<[string, string | undefined]>} entries
 * @param {string} indent
 */
function declarations(entries, indent) {
    return entries.map(([name, value]) => `${indent}--${name}: ${value};`).join('\n');
}

/**
 * @param {TokenFamily | undefined} family
 * @param {string} theme
 * @returns {Array<[string, string | undefined]>}
 */
function themed(family, theme) {
    return (family?.tokens ?? []).map((token) => [
        token.name,
        typeof token.value === 'string' ? token.value : token.value[theme],
    ]);
}

/**
 * @param {TokenFamily | undefined} family
 * @returns {Array<[string, string | undefined]>}
 */
function plain(family) {
    return (family?.tokens ?? []).map((token) => [
        token.name,
        typeof token.value === 'string' ? token.value : undefined,
    ]);
}

/** @param {Tokens} tokens */
export function renderTokensCss(tokens) {
    /** @type {Array<[string, string]>} */
    const families = Object.entries(tokens.type.families).map(([name, stack]) => [`font-${name}`, stack]);
    /** @type {Array<[string, string]>} */
    const styles = tokens.type.groups.flatMap((group) =>
        group.styles.map(
            (style) =>
                /** @type {[string, string]} */ ([
                    `type-${style.name}`,
                    `${style.fontWeight} ${style.fontSize} / ${style.lineHeight} var(--font-${style.family ?? group.family})`,
                ]),
        ),
    );
    const light = [...themed(tokens.color, 'light'), ...themed(tokens.shadow, 'light')];
    const dark = [...themed(tokens.color, 'dark'), ...themed(tokens.shadow, 'dark')];
    const constant = [...plain(tokens.spacing), ...plain(tokens.radius), ...plain(tokens.size), ...families, ...styles];
    return `/* Generated from tokens.json by \`pnpm --filter @nestrum/admin-ui tokens\`. Do not edit by hand. */
/* Light is the default; dark follows the system setting unless data-theme on <html> overrides it. */
:root {
    color-scheme: light;
${declarations(light, '    ')}
${declarations(constant, '    ')}
}

@media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
        color-scheme: dark;
${declarations(dark, '        ')}
    }
}

:root[data-theme="dark"] {
    color-scheme: dark;
${declarations(dark, '    ')}
}
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    writeFileSync(cssPath, renderTokensCss(readTokens()));
    console.log(`Wrote ${cssPath}`);
}
