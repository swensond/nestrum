import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

/** A self-signed, long-lived certificate used only by tests. */
export const TEST_CERTIFICATE =
    'MIIDGTCCAgGgAwIBAgIUcf+o9R1DFq7E+ei3xBYCdGfuTWcwDQYJKoZIhvcNAQELBQAwGzEZMBcGA1UEAwwQaWRwLmV4YW1wbGUudGVzdDAgFw0yNjA5MzAxNjQxMTZaGA8yMTI2MDkwNjE2NDExNlowGzEZMBcGA1UEAwwQaWRwLmV4YW1wbGUudGVzdDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAN0JFINEPY91xiB43xaGykGORmFlvfzVWMNwMPX2vKrs0Y7+Z0MMJh8xCbDWSEQm7EmaDbGggcETASuGAlgA3Iwfs10fc6eaN5EEradmoqxae8d6c7S3Bk9ZKdjrpRb95zcBnjCicHM1BquZCW9THP6aLiVi1XPB6AnzlqIPTPXIKONEHTB0obHOfyvVbl7hKWjQlgFAJfuGbu+RWlnr/lpWtDMdUSBAZlPRV/NfvEfIRcVkG42Fa/ZiA2z+FnWdSxitf3Y2fEK0GarJ0RKfqpjCCBDzculbbGKKbQePX73XTnmaIOIfNa5ibHAjS8RwvPlhElqXjStmG7hbi2Kexp0CAwEAAaNTMFEwHQYDVR0OBBYEFCqPjF7c/7Q9L9HcnnHmksllH+joMB8GA1UdIwQYMBaAFCqPjF7c/7Q9L9HcnnHmksllH+joMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAEpSLYi1k1iLBA6SGWOW3WHrcqq2FBhev+8ESF1sq0WSbD1FBEa/pob41yRS1PlLBk6fOxTy1y+RyVdNSnGw8RnuFikuhxvYpvm6tJRRqCMjGkmpSj+lRIp9FD7Dis2aJ2d/f6n2Mi+Tw1HGMvJrUgTQ2nxMUECk+61NV4xeCyIiQSA88xdCRg1E+zPLOURsIyCXmJJMOPCxC0g3qQFua07JZ0Z2AU+F2e+hAA63Vaylldc8L1pwC/AgEowUAkJsTLH3T30X22zS8WoAacBlJsZPa99pd1tijp9hRz1NHlvRrjoOWQLMj8vs09szArcKKsbTBus4/ri21bSmoRaU0I4=';

/** Private key for {@link TEST_CERTIFICATE}; used only to sign test SAML responses. */
export const TEST_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDdCRSDRD2PdcYg
eN8WhspBjkZhZb381VjDcDD19ryq7NGO/mdDDCYfMQmw1khEJuxJmg2xoIHBEwEr
hgJYANyMH7NdH3OnmjeRBK2nZqKsWnvHenO0twZPWSnY66UW/ec3AZ4wonBzNQar
mQlvUxz+mi4lYtVzwegJ85aiD0z1yCjjRB0wdKGxzn8r1W5e4Slo0JYBQCX7hm7v
kVpZ6/5aVrQzHVEgQGZT0VfzX7xHyEXFZBuNhWv2YgNs/hZ1nUsYrX92NnxCtBmq
ydESn6qYwggQ83LpW2xiim0Hj1+91055miDiHzWuYmxwI0vEcLz5YRJal40rZhu4
W4tinsadAgMBAAECggEAE8i+R0mSYQbfpwRqo2+JJvj/H7Slnr3R5hxipYFiPcJY
t33Z7ExoFR6kiWmEqmT5fVUGqMF/G7MBxc2G5C2fkAM+YLVx+qx5EMfkazlqkha/
QYmaVbCUJgILFtlwu3Aag/fnGt9PRWCXqkBWcdp0m+1c+Aeyp1vR0yI0d2j7MHyB
Wv255kPq77Oo5AtkajYNZWz+1/9p/8QyrfprO40lnsQlRejw7+dfSHwFZNo+JgpP
BczRbN+QPg21p+Vp0Lazyza5ay7O8OKKEFIyGB/cg/0f9HdwXdZTfjIBMMJEPhO9
YeRU0a7i/rJehU42ANb4newC10yWzI6Y3WRfUyoiGQKBgQD5S/9xOfef38OCaEQ2
bBSq2TaAE90gnUxu7S6chEBbvkO36nkALpa2VGv0o/TJRc6X3CEKqAK8QMvQmdHG
PIORFUFapDphA6ViopZKyQz4wnEKR5GNKwIiMgTyfVJMaInkjPs3b5L5XjAtw5Fq
EbyUynMslaGjsZlZlSHhDP6gOwKBgQDi+ox3a0fMrpSE2bmF6L2saDhnlJvt7MAi
Tb/+bNPSRRBHK3roQVahQM0Vw95haGzYlnAM5R5DO9RbQQPqAnBgSlxRbP0l/tcT
E+LFHe8DBD4kCMasKyj25i2y+oH8MDVCk24tWkvKmicE/pVnMdT/u4OkKbWq7m+Q
0siwue/fBwKBgQDlTbMa+Z+8LT0O4UsE5+smrv8DVcIKssTQL1e1Xaw49swhCgnc
Uf4MnaBi+MA6tfvuEOtPevRxJgSSzjl25sh5lZx0fCS6gXkJPdWR2lYVJfyF4QiP
WaTvwSRtyzn80Bct40NbXURKHQmhvoYtkzzrez/vHX79K2mLTbJI6AP5awKBgQCV
Key36iPESpLF/8OhUgOcUt2GjK4wnN7jbE8ZZ/GIhOSesN9T1OSWklx0ykTRpOur
Jqo6fzP1IVN8KOzmk3XAgf3LcSGoH6K+IdpsijBxvg8MZUwTB0Yjg79SmLhlwFSw
DO1iFq4qVkYATUJoD+KXsWZgsxx1Wb6t4SgMpBUUbwKBgGn7qiFDXW7vBJ9D+xIc
CIGgLOwRMdLSfSUZW1maW36SjeaIw8lzQus7hzqiYBEX12TamdXpTXF8vDYZJ1oE
7iuwqymlm3+d76PW/VEZlWv9rn7qxGn2uLYVPKIJRZ1K4Pp+70bNHf8KeQvk2Z1W
WnunIZhFHo+F2405evfZEluf
-----END PRIVATE KEY-----`;

export function idpMetadata(entityId = 'https://idp.example.test/entity', certificate = TEST_CERTIFICATE): string {
    return `<?xml version="1.0"?><EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${entityId}"><IDPSSODescriptor WantAuthnRequestsSigned="false" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"><KeyDescriptor use="signing"><KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><X509Data><X509Certificate>${certificate}</X509Certificate></X509Data></KeyInfo></KeyDescriptor><NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</NameIDFormat><SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.example.test/sso"/><SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="https://idp.example.test/sso"/></IDPSSODescriptor></EntityDescriptor>`;
}

/** A minimal OpenID provider: discovery, JWKS and a token endpoint that issues a signed ID token. */
export async function startFakeOidc(options: { readonly issuerSuffix?: string; readonly email?: string } = {}) {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
    const state = {
        clientId: 'client-1',
        secrets: [] as string[],
        tokenRequests: 0,
        discoveryHits: 0,
        email: options.email ?? 'sso.user@acme.test',
    };
    let issuer = '';
    const server = createServer(async (request, response) => {
        const url = new URL(request.url ?? '/', issuer);
        const send = (status: number, body: unknown) => {
            response.writeHead(status, { 'content-type': 'application/json' });
            response.end(JSON.stringify(body));
        };
        if (url.pathname === `${options.issuerSuffix ?? ''}/.well-known/openid-configuration`) {
            state.discoveryHits += 1;

            return send(200, {
                issuer,
                authorization_endpoint: `${issuer}/authorize`,
                token_endpoint: `${issuer}/token`,
                jwks_uri: `${issuer}/jwks`,
                userinfo_endpoint: `${issuer}/userinfo`,
                token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
                scopes_supported: ['openid', 'email', 'profile'],
                response_types_supported: ['code'],
                subject_types_supported: ['public'],
                id_token_signing_alg_values_supported: ['RS256'],
            });
        }
        if (url.pathname === '/userinfo') {
            return send(200, { sub: 'idp-subject-1', email: state.email, email_verified: true, name: 'Sso User' });
        }
        if (url.pathname === '/jwks') {
            return send(200, { keys: [jwk] });
        }
        if (url.pathname === '/token' && request.method === 'POST') {
            let body = '';
            for await (const chunk of request) {
                body += chunk;
            }
            state.tokenRequests += 1;
            state.secrets.push(`${request.headers.authorization ?? ''}${body}`);
            const idToken = await new SignJWT({ email: state.email, email_verified: true, name: 'Sso User' })
                .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
                .setIssuer(issuer)
                .setAudience(state.clientId)
                .setSubject('idp-subject-1')
                .setIssuedAt()
                .setExpirationTime('5m')
                .sign(privateKey);

            return send(200, {
                access_token: 'access-token-value',
                token_type: 'Bearer',
                id_token: idToken,
                expires_in: 300,
            });
        }
        return send(404, { error: 'not_found' });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    issuer = `${origin}${options.issuerSuffix ?? ''}`;

    return { origin, issuer, state, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
