import { AppError } from '@nestrum/core';

const PREFIX = 'nsso1:';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64url');
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
    return new Uint8Array(Buffer.from(value, 'base64url'));
}

/** AES-256-GCM sealing for provider secrets, keyed from the auth secret by HKDF so no second secret is configured. */
export class SecretBox {
    private key: Promise<CryptoKey> | undefined;

    constructor(private readonly secret: string) {}

    private derive(): Promise<CryptoKey> {
        this.key ??= (async () => {
            const material = await crypto.subtle.importKey('raw', encoder.encode(this.secret), 'HKDF', false, [
                'deriveKey',
            ]);

            return crypto.subtle.deriveKey(
                {
                    name: 'HKDF',
                    hash: 'SHA-256',
                    salt: encoder.encode('nestrum.sso.v1'),
                    info: encoder.encode('secrets'),
                },
                material,
                { name: 'AES-GCM', length: 256 },
                false,
                ['encrypt', 'decrypt'],
            );
        })();

        return this.key;
    }

    static sealed(value: unknown): value is string {
        return typeof value === 'string' && value.startsWith(PREFIX);
    }

    async seal(plaintext: string): Promise<string> {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const cipher = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            await this.derive(),
            encoder.encode(plaintext),
        );

        return `${PREFIX}${toBase64(iv)}.${toBase64(new Uint8Array(cipher))}`;
    }

    async open(sealed: string): Promise<string> {
        const [iv, cipher] = sealed.slice(PREFIX.length).split('.');
        if (!SecretBox.sealed(sealed) || !iv || !cipher) {
            throw new AppError('SSO_SECRET_INVALID', 'A stored SSO secret is malformed.', 500);
        }
        try {
            const plain = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: fromBase64(iv) },
                await this.derive(),
                fromBase64(cipher),
            );

            return decoder.decode(plain);
        } catch {
            throw new AppError(
                'SSO_SECRET_UNREADABLE',
                'A stored SSO secret could not be decrypted; the auth secret may have changed.',
                500,
            );
        }
    }
}

type Json = Record<string, unknown>;

/** JSON paths inside `oidcConfig` and `samlConfig` that hold private values and are encrypted at rest. */
const OIDC_SECRET_PATHS = [['clientSecret']] as const;
const SAML_SECRET_PATHS = [
    ['privateKey'],
    ['spMetadata', 'privateKey'],
    ['spMetadata', 'privateKeyPass'],
    ['spMetadata', 'encPrivateKey'],
    ['spMetadata', 'encPrivateKeyPass'],
    ['idpMetadata', 'privateKey'],
    ['idpMetadata', 'privateKeyPass'],
    ['idpMetadata', 'encPrivateKey'],
    ['idpMetadata', 'encPrivateKeyPass'],
] as const;

async function transform(
    text: unknown,
    paths: readonly (readonly string[])[],
    apply: (value: string) => Promise<string>,
    applies: (value: string) => boolean,
): Promise<unknown> {
    if (typeof text !== 'string' || !text) {
        return text;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return text;
    }
    if (!parsed || typeof parsed !== 'object') {
        return text;
    }
    for (const path of paths) {
        let holder = parsed as Json;
        for (const part of path.slice(0, -1)) {
            const next = holder[part];
            if (!next || typeof next !== 'object') {
                holder = {};
                break;
            }
            holder = next as Json;
        }
        const leaf = path[path.length - 1] as string;
        const value = holder[leaf];
        if (typeof value === 'string' && value !== '' && applies(value)) {
            holder[leaf] = await apply(value);
        }
    }

    return JSON.stringify(parsed);
}

/** Encrypts private values in the two JSON config columns; already-sealed values are left as they are. */
export async function sealProviderConfig(box: SecretBox, row: Json): Promise<Json> {
    const out: Json = { ...row };
    const seal = (value: string) => box.seal(value);
    const plain = (value: string) => !SecretBox.sealed(value);
    if ('oidcConfig' in out) {
        out.oidcConfig = await transform(out.oidcConfig, OIDC_SECRET_PATHS, seal, plain);
    }
    if ('samlConfig' in out) {
        out.samlConfig = await transform(out.samlConfig, SAML_SECRET_PATHS, seal, plain);
    }

    return out;
}

export async function openProviderConfig(box: SecretBox, row: Json): Promise<Json> {
    const out: Json = { ...row };
    const open = (value: string) => box.open(value);
    if ('oidcConfig' in out) {
        out.oidcConfig = await transform(out.oidcConfig, OIDC_SECRET_PATHS, open, SecretBox.sealed);
    }
    if ('samlConfig' in out) {
        out.samlConfig = await transform(out.samlConfig, SAML_SECRET_PATHS, open, SecretBox.sealed);
    }

    return out;
}
