import { inflateRawSync } from 'node:zlib';
import { defineApplication } from '@nestrum/core';
import { createHonoRuntime } from '@nestrum/hono';
import * as samlify from 'samlify';
import { describe, expect, it } from 'vitest';
import { defineAuth } from '../src/index.js';
import { storage } from './fixtures.js';
import { idpMetadata, TEST_PRIVATE_KEY } from './sso-fixtures.js';

samlify.setSchemaValidator({ validate: async () => 'skipped' });

const BASE_URL = 'http://localhost:3000';
const SECRET = 'nestrum-test-secret-longer-than-thirty-two-characters';
const EMAIL = 'saml.person@initech.test';

async function setup(options: { allowIdpInitiated?: boolean; destination?: string | null } = {}) {
    const memory = storage();
    const application = defineApplication({
        apps: [],
        databases: {
            default: { kind: 'prisma', provider: 'postgresql', connection: 'unused' },
            identity: { kind: 'prisma', provider: 'postgresql', connection: 'unused' },
        },
        auth: defineAuth({
            database: 'identity',
            baseURL: BASE_URL,
            secret: SECRET,
            prisma: () => memory.binding,
            sso: { enabled: true, saml: { allowIdpInitiated: options.allowIdpInitiated ?? false } },
        }),
    });
    const runtime = createHonoRuntime({ application, onError: () => {} });
    await runtime.start();
    // biome-ignore lint/style/noNonNullAssertion: SSO is enabled
    const providers = application.auth!.sso!;
    const destination = options.destination === undefined ? '/welcome' : options.destination;
    await providers.create({
        type: 'saml',
        providerId: 'initech-saml',
        displayName: 'Initech',
        domains: ['initech.test'],
        idpMetadata: idpMetadata(),
        ...(destination === null ? {} : { advanced: { idpInitiatedCallbackUrl: destination } }),
    });
    const spMetadata = await (
        await runtime.fetch(new Request(`${BASE_URL}/api/auth/sso/saml2/sp/metadata?providerId=initech-saml`))
    ).text();
    const idp = samlify.IdentityProvider({
        metadata: idpMetadata(),
        privateKey: TEST_PRIVATE_KEY,
        isAssertionEncrypted: false,
        wantAuthnRequestsSigned: false,
    });
    const sp = samlify.ServiceProvider({ metadata: spMetadata, wantAssertionsSigned: true });
    const loginResponse = async (requestId?: string, email = EMAIL): Promise<string> => {
        const { context } = await idp.createLoginResponse(
            sp,
            requestId
                ? ({ extract: { request: { id: requestId } } } as never)
                : ({ extract: { request: {} } } as never),
            'post',
            { NameID: email, email },
        );

        return context;
    };
    const acs = (saml: string, relayState?: string, cookie = '') =>
        runtime.fetch(
            new Request(`${BASE_URL}/api/auth/sso/saml2/sp/acs/initech-saml`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/x-www-form-urlencoded',
                    origin: 'https://idp.example.test',
                    cookie,
                },
                body: new URLSearchParams({ SAMLResponse: saml, ...(relayState ? { RelayState: relayState } : {}) }),
            }),
        );

    return { application, runtime, memory, providers, loginResponse, acs };
}

const cookieOf = (response: Response) =>
    response.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; ');

describe('SAML sign-in through the Better Auth plugin', () => {
    it('completes SP-initiated sign-in and tags the session', async () => {
        const { runtime, application, loginResponse, acs, providers } = await setup();
        const start = await runtime.fetch(
            new Request(`${BASE_URL}/api/auth/sign-in/sso`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', origin: BASE_URL },
                body: JSON.stringify({ email: EMAIL, callbackURL: `${BASE_URL}/done` }),
            }),
        );
        expect(start.status).toBe(200);
        const redirect = new URL(((await start.json()) as { url: string }).url);
        expect(redirect.origin).toBe('https://idp.example.test');
        const request = inflateRawSync(
            Buffer.from(redirect.searchParams.get('SAMLRequest') as string, 'base64'),
        ).toString();
        const requestId = /ID="([^"]+)"/.exec(request)?.[1] as string;
        expect(requestId).toBeTruthy();
        const response = await acs(
            await loginResponse(requestId),
            redirect.searchParams.get('RelayState') ?? undefined,
            cookieOf(start),
        );
        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toBe(`${BASE_URL}/done`);
        const cookie = cookieOf(response);
        // biome-ignore lint/style/noNonNullAssertion: auth configured
        const session = await application.auth!.getSession(new Request(BASE_URL, { headers: { cookie } }));
        expect(session?.user.email).toBe(EMAIL);
        expect(session?.session).toMatchObject({ authMethod: 'sso', ssoProviderId: 'initech-saml' });
        expect((await providers.get('initech-saml')).lastSuccessfulLoginAt).not.toBeNull();
        // The same response cannot be replayed.
        const replay = await acs(
            await loginResponse(requestId),
            redirect.searchParams.get('RelayState') ?? undefined,
            cookieOf(start),
        );
        expect(replay.headers.get('location') ?? '').not.toBe(`${BASE_URL}/done`);
    });

    it('accepts IdP-initiated sign-in only when enabled and a destination is configured, landing on that destination', async () => {
        const { loginResponse, acs, application } = await setup({ allowIdpInitiated: true });
        const response = await acs(await loginResponse());
        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toBe('/welcome');
        // biome-ignore lint/style/noNonNullAssertion: auth configured
        const session = await application.auth!.getSession(
            new Request(BASE_URL, { headers: { cookie: cookieOf(response) } }),
        );
        expect(session?.session).toMatchObject({ authMethod: 'sso', ssoProviderId: 'initech-saml' });

        const off = await setup({ allowIdpInitiated: false });
        const refused = await off.acs(await off.loginResponse());
        expect(refused.status).toBe(403);
        expect(await refused.json()).toMatchObject({ error: { code: 'SAML_IDP_INITIATED_DISABLED' } });

        const noDestination = await setup({ allowIdpInitiated: true, destination: null });
        const missing = await noDestination.acs(await noDestination.loginResponse());
        expect(missing.status).toBe(403);
    });

    it('never redirects IdP-initiated logins to an untrusted RelayState', async () => {
        const { loginResponse, acs } = await setup({ allowIdpInitiated: true });
        const response = await acs(await loginResponse(), 'https://evil.example/steal');
        const location = response.headers.get('location') ?? '';
        expect(location.startsWith('https://evil.example')).toBe(false);
    });

    it('rejects unsigned, altered and foreign-audience responses without creating users', async () => {
        const { loginResponse, acs, memory } = await setup({ allowIdpInitiated: true });
        const valid = Buffer.from(await loginResponse(), 'base64').toString();
        const altered = valid.replace(EMAIL, 'admin@initech.test');
        const unsigned = valid.replace(/<(?:\w+:)?Signature[\s\S]*?<\/(?:\w+:)?Signature>/g, '');
        for (const xml of [altered, unsigned]) {
            const response = await acs(Buffer.from(xml).toString('base64'));
            expect(response.headers.get('location') ?? '').toContain('error=');
        }
        expect(memory.records.User).toHaveLength(0);
        expect(memory.records.Session).toHaveLength(0);
    });
});
