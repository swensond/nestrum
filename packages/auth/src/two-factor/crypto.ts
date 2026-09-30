import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomInt } from 'node:crypto';

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_LENGTH = 12;

export type TwoFactorKeys = {
    encrypt(plaintext: string): string;
    decrypt(sealed: string): string;
    hashRecoveryCode(code: string): string;
};

/** Derives independent purpose-bound keys from the auth secret, so rotating unrelated secrets is not implied. */
export function createTwoFactorKeys(secret: string): TwoFactorKeys {
    const derive = (info: string) =>
        Buffer.from(hkdfSync('sha256', secret, 'nestrum.auth.two-factor', info, 32) as ArrayBuffer);
    const encryptionKey = derive('secret-encryption.v1');
    const hashKey = derive('recovery-code-hash.v1');

    return Object.freeze({
        encrypt(plaintext: string): string {
            const iv = randomBytes(12);
            const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
            const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

            return [
                'v1',
                iv.toString('base64url'),
                body.toString('base64url'),
                cipher.getAuthTag().toString('base64url'),
            ].join('.');
        },
        decrypt(sealed: string): string {
            const [version, iv, body, tag] = sealed.split('.');
            if (version !== 'v1' || !iv || !body || !tag) {
                throw new Error('Unsupported sealed value.');
            }
            const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(iv, 'base64url'));
            decipher.setAuthTag(Buffer.from(tag, 'base64url'));

            return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
        },
        hashRecoveryCode: (code: string) =>
            createHmac('sha256', hashKey).update(normalizeRecoveryCode(code)).digest('hex'),
    });
}

export function normalizeRecoveryCode(code: string): string {
    return code.replace(/[\s-]/g, '').toUpperCase();
}

/** 60 bits from a CSPRNG, shown as XXXX-XXXX-XXXX. */
export function generateRecoveryCode(): string {
    let raw = '';
    for (let index = 0; index < RECOVERY_CODE_LENGTH; index += 1) {
        raw += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
    }

    return raw.match(/.{4}/g)?.join('-') ?? raw;
}

export function isRecoveryCodeShape(code: string): boolean {
    return new RegExp(`^[${RECOVERY_ALPHABET}]{${RECOVERY_CODE_LENGTH}}$`).test(normalizeRecoveryCode(code));
}
