import type { TwoFactorReason } from './metadata.js';

const ORIGIN = 'http://admin.invalid';
export const ADMIN_HOME = '/admin';

/** The framework-owned sign-in challenge pages. SSO management lives under `/admin/auth/sso` but is an ordinary page. */
export function isAuthPath(pathname: string): boolean {
    if (pathname === '/admin/auth/sso' || pathname.startsWith('/admin/auth/sso/')) {
        return false;
    }

    return pathname === '/admin/auth' || pathname.startsWith('/admin/auth/');
}

/**
 * Accepts only a same-origin path inside the admin UI (never a challenge page, so it cannot loop) and drops any
 * fragment. Everything else, including absolute URLs, protocol-relative paths and backslash tricks, becomes /admin.
 */
export function safeReturnTo(value: unknown): string {
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.length > 2048 ||
        !value.startsWith('/') ||
        value.startsWith('//') ||
        // biome-ignore lint/suspicious/noControlCharactersInRegex: rejects control characters in redirect targets
        /[\\\u0000-\u001f\u007f]/.test(value)
    ) {
        return ADMIN_HOME;
    }
    let url: URL;
    try {
        url = new URL(value, ORIGIN);
    } catch {
        return ADMIN_HOME;
    }
    if (
        url.origin !== ORIGIN ||
        (url.pathname !== '/admin' && !url.pathname.startsWith('/admin/')) ||
        isAuthPath(url.pathname)
    ) {
        return ADMIN_HOME;
    }

    return `${url.pathname}${url.search}`;
}

/** Where a browser navigation goes when it lacks assurance, carrying the intended admin URL. */
export function twoFactorHref(reason: TwoFactorReason, intended: URL): string {
    const target = reason === 'setup-required' ? '/admin/auth/2fa/setup' : '/admin/auth/2fa';
    const next = safeReturnTo(`${intended.pathname}${intended.search}`);

    return next === ADMIN_HOME ? target : `${target}?next=${encodeURIComponent(next)}`;
}

export function withNext(path: string, next: string): string {
    return next === ADMIN_HOME ? path : `${path}?next=${encodeURIComponent(next)}`;
}
