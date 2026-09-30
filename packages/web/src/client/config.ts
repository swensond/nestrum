import { PUBLIC_CONFIG_ELEMENT } from '../constants.js';

/** Read the allowlisted `web.publicEnv` values the server embedded in the page. Empty outside a Nestrum host. */
export function readPublicConfig(
    doc: Pick<Document, 'getElementById'> | undefined = globalThis.document,
): Readonly<Record<string, string>> {
    const element = doc?.getElementById(PUBLIC_CONFIG_ELEMENT);
    if (!element?.textContent) {
        return {};
    }
    try {
        const parsed = JSON.parse(element.textContent) as Record<string, unknown>;

        return Object.freeze(
            Object.fromEntries(
                Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
            ),
        );
    } catch {
        return {};
    }
}
