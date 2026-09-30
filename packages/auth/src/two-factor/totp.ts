import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Steps accepted on either side of the current one to tolerate small client clock drift. */
export const TOTP_WINDOW = 1;

export function base32Encode(bytes: Uint8Array): string {
    let bits = 0;
    let value = 0;
    let output = '';
    for (const byte of bytes) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            output += ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) {
        output += ALPHABET[(value << (5 - bits)) & 31];
    }

    return output;
}

export function base32Decode(input: string): Buffer {
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

export function generateTotpSecret(): string {
    return base32Encode(randomBytes(20));
}

export function totpStep(nowMs: number): number {
    return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

/** RFC 6238 (HMAC-SHA1, 30 second period, 6 digits) using RFC 4226 dynamic truncation. */
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

    return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

/**
 * Returns the matching time step, or undefined. Every candidate step is compared so timing does not reveal which
 * offset matched.
 */
export function matchTotp(secret: string, code: string, nowMs: number): number | undefined {
    if (!/^\d{6}$/.test(code)) {
        return undefined;
    }
    const current = totpStep(nowMs);
    let matched: number | undefined;
    for (let offset = -TOTP_WINDOW; offset <= TOTP_WINDOW; offset += 1) {
        const step = current + offset;
        if (step >= 0 && timingSafeEqual(Buffer.from(totpCode(secret, step)), Buffer.from(code))) {
            matched = step;
        }
    }

    return matched;
}

export function otpauthUri(secret: string, issuer: string, account: string): string {
    const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
    const query = new URLSearchParams({
        secret,
        issuer,
        algorithm: 'SHA1',
        digits: String(TOTP_DIGITS),
        period: String(TOTP_PERIOD_SECONDS),
    });

    return `otpauth://totp/${label}?${query}`;
}
