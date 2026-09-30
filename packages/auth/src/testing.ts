import { createHmac } from 'node:crypto';

// Test and tooling helpers only. Production TOTP generation and verification belong to Better Auth's `twoFactor`
// plugin; these compute the current code from an authenticator secret so tests and scripts can act as the user.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_PERIOD_SECONDS = 30;

function base32Decode(input: string): Buffer {
    const bytes: number[] = [];
    let bits = 0;
    let value = 0;
    for (const character of input.replace(/=+$/, '').toUpperCase()) {
        const index = ALPHABET.indexOf(character);
        if (index < 0) {
            throw new Error('Invalid base32 input.');
        }
        value = (value << 5) | index;
        bits += 5;
        if (bits >= 8) {
            bytes.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }

    return Buffer.from(bytes);
}

export function totpStep(nowMs: number): number {
    return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

/** The `secret` query parameter of the `otpauth://` URI Better Auth returns from `two-factor/enable`. */
export function totpSecretFromUri(uri: string): string {
    const secret = new URL(uri).searchParams.get('secret');
    if (!secret) {
        throw new Error('The otpauth URI has no secret.');
    }

    return secret;
}

/** RFC 6238 six-digit code (HMAC-SHA1, 30 second period) for a base32 secret, as in the otpauth URI. */
export function totpCode(secret: string, step: number): string {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();
    const offset = (digest[digest.length - 1] ?? 0) & 15;
    const binary =
        (((digest[offset] ?? 0) & 127) << 24) |
        ((digest[offset + 1] ?? 0) << 16) |
        ((digest[offset + 2] ?? 0) << 8) |
        (digest[offset + 3] ?? 0);

    return String(binary % 10 ** 6).padStart(6, '0');
}
