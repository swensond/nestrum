import type { SsoRegistry } from '#auth/sso/service';

const PROVIDER_ID = '[a-z][a-z0-9-]{1,62}[a-z0-9]';
const CALLBACK = new RegExp(`^/api/auth/sso/callback/(${PROVIDER_ID})$`);
const ACS = new RegExp(`^/api/auth/sso/saml2/sp/acs/(${PROVIDER_ID})$`);
const MAX_BODY_BYTES = 8 * 1024;

function failure(status: number, code: string, message: string, extra: object = {}): Response {
    return Response.json({ error: { code, message, ...extra } }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** POST /sso/saml2/sp/acs is a cross-site form post from the IdP, so it cannot carry a same-site Origin. */
export function isSamlAcsPost(request: Request, path: string): boolean {
    return request.method === 'POST' && ACS.test(path);
}

/** True when the posted SAML response carries no `InResponseTo`, i.e. the IdP started the sign-in. */
async function isUnsolicited(request: Request): Promise<boolean> {
    try {
        const body = await request.clone().formData();
        const encoded = body.get('SAMLResponse');
        if (typeof encoded !== 'string' || encoded.length > 2_000_000) {
            return false;
        }

        return !/InResponseTo\s*=\s*["'][^"']+["']/.test(Buffer.from(encoded, 'base64').toString('utf8'));
    } catch {
        return false;
    }
}

function text(value: unknown, max: number): string | undefined {
    return typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined;
}

/**
 * Nestrum's SSO surface over Better Auth's plugin. Returns a response when the path is an SSO path, or `undefined`
 * so the caller continues with its own allowlist. Only sign-in, the two protocol callbacks, SP metadata and login
 * discovery are reachable; the plugin's provider-management endpoints never are.
 */
export async function handleSso(
    request: Request,
    path: string,
    registry: SsoRegistry,
    forward: (request: Request) => Promise<Response>,
    redirects: { readonly origins: readonly string[] },
): Promise<Response | undefined> {
    /** A post-login target is a same-site path or an absolute URL on a trusted origin; anything else is refused. */
    const safeTarget = (value: string | undefined): boolean => {
        if (value === undefined) {
            return true;
        }
        if (/^\/(?![/\\])/.test(value)) {
            return true;
        }
        try {
            const target = new URL(value);

            return ['http:', 'https:'].includes(target.protocol) && redirects.origins.includes(target.origin);
        } catch {
            return false;
        }
    };
    if (path === '/api/auth/sso/discover' && request.method === 'GET') {
        const params = new URL(request.url).searchParams;
        const result = await registry.discover({
            ...(text(params.get('email'), 320) === undefined
                ? {}
                : { email: text(params.get('email'), 320) as string }),
            ...(text(params.get('domain'), 253) === undefined
                ? {}
                : { domain: text(params.get('domain'), 253) as string }),
            ...(text(params.get('providerId'), 64) === undefined
                ? {}
                : { providerId: text(params.get('providerId'), 64) as string }),
            ...(text(params.get('organizationSlug'), 128) === undefined
                ? {}
                : { organizationSlug: text(params.get('organizationSlug'), 128) as string }),
        });

        return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (path === '/api/auth/sign-in/sso' && request.method === 'POST') {
        const raw = await request.text();
        let body: Record<string, unknown>;
        try {
            const parsed: unknown = JSON.parse(raw);
            if (raw.length > MAX_BODY_BYTES || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error();
            }
            body = parsed as Record<string, unknown>;
        } catch {
            return failure(400, 'SSO_INVALID_INPUT', 'Invalid sign-in request.');
        }
        const callbackURL = text(body.callbackURL, 2048);
        if (!callbackURL) {
            return failure(400, 'SSO_INVALID_INPUT', 'callbackURL is required.');
        }
        if (![callbackURL, text(body.errorCallbackURL, 2048), text(body.newUserCallbackURL, 2048)].every(safeTarget)) {
            return failure(400, 'SSO_REDIRECT_UNTRUSTED', 'The redirect target is not a trusted origin.');
        }
        const email = text(body.email, 320);
        const found = await registry.discover({
            ...(text(body.providerId, 64) === undefined ? {} : { providerId: text(body.providerId, 64) as string }),
            ...(email === undefined ? {} : { email }),
            ...(text(body.domain, 253) === undefined ? {} : { domain: text(body.domain, 253) as string }),
            ...(text(body.organizationSlug, 128) === undefined
                ? {}
                : { organizationSlug: text(body.organizationSlug, 128) as string }),
        });
        if (found.status === 'none') {
            return failure(404, 'SSO_PROVIDER_NOT_FOUND', 'No enabled SSO provider matches this sign-in.');
        }
        if (found.status === 'choice') {
            return failure(409, 'SSO_DISCOVERY_AMBIGUOUS', 'Several SSO providers match; choose one.', {
                providers: found.providers,
            });
        }
        // Only an explicit allowlist reaches Better Auth: the provider is the one Nestrum resolved and enabled, and
        // client-supplied scopes and extra authorization parameters are dropped.
        const forwarded = JSON.stringify({
            providerId: found.provider.providerId,
            callbackURL,
            ...(text(body.errorCallbackURL, 2048) === undefined
                ? {}
                : { errorCallbackURL: text(body.errorCallbackURL, 2048) }),
            ...(text(body.newUserCallbackURL, 2048) === undefined
                ? {}
                : { newUserCallbackURL: text(body.newUserCallbackURL, 2048) }),
            ...((text(body.loginHint, 320) ?? email) === undefined
                ? {}
                : { loginHint: text(body.loginHint, 320) ?? email }),
            ...(body.requestSignUp === true ? { requestSignUp: true } : {}),
        });
        const headers = new Headers(request.headers);
        headers.set('content-type', 'application/json');
        headers.delete('content-length');

        return forward(new Request(request.url, { method: 'POST', headers, body: forwarded }));
    }
    const callback = CALLBACK.exec(path) ?? ACS.exec(path);
    if (
        callback &&
        ['GET', 'POST'].includes(request.method) &&
        (CALLBACK.test(path) ? request.method === 'GET' : true)
    ) {
        const providerId = callback[1] as string;
        if (!(await registry.isEnabled(providerId))) {
            return failure(403, 'SSO_PROVIDER_DISABLED', 'This SSO provider is not available.');
        }
        if (request.method === 'POST' && ACS.test(path) && (await isUnsolicited(request))) {
            // Conservative pre-check; Better Auth still validates the response and its InResponseTo handling.
            if (!(await registry.allowsIdpInitiated(providerId))) {
                return failure(
                    403,
                    'SAML_IDP_INITIATED_DISABLED',
                    'IdP-initiated sign-in is not enabled for this provider.',
                );
            }
        }

        return forward(request);
    }
    if (path === '/api/auth/sso/saml2/sp/metadata' && request.method === 'GET') {
        const providerId = new URL(request.url).searchParams.get('providerId') ?? '';
        if (!new RegExp(`^${PROVIDER_ID}$`).test(providerId) || !(await registry.isEnabled(providerId))) {
            return failure(404, 'NOT_FOUND', 'Route not found.');
        }

        return forward(request);
    }

    return undefined;
}
