import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

function ipv4Private(address: string): boolean {
    const [a = 0, b = 0] = address.split('.').map(Number);

    return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 192 && b === 0) ||
        (a === 198 && (b === 18 || b === 19)) ||
        a >= 224
    );
}

/** Loopback, private, link-local, unique-local, unspecified and multicast addresses. */
export function isPrivateAddress(address: string): boolean {
    const host = address.replace(/^\[|\]$/g, '').toLowerCase();
    const family = isIP(host);
    if (family === 4) {
        return ipv4Private(host);
    }
    if (family === 6) {
        const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
        if (mapped?.[1]) {
            return ipv4Private(mapped[1]);
        }

        return (
            host === '::' || host === '::1' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith('ff')
        );
    }

    return false;
}

function privateName(hostname: string): boolean {
    return (
        hostname === 'localhost' ||
        hostname.endsWith('.localhost') ||
        hostname.endsWith('.local') ||
        hostname.endsWith('.internal') ||
        !hostname.includes('.')
    );
}

/**
 * An IdP URL is acceptable when it is HTTPS on a public host, or its origin was declared by the operator.
 * Hostnames are also resolved so a public-looking name that points at a private address is rejected.
 */
export async function assertIdpUrl(
    value: string,
    allowlist: readonly string[],
    resolve: (host: string) => Promise<readonly string[]> = async (host) =>
        (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address),
): Promise<string> {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error('invalid-url');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('invalid-url');
    }
    if (allowlist.includes(url.origin)) {
        return url.origin;
    }
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (url.protocol !== 'https:' || privateName(host) || isPrivateAddress(host)) {
        throw new Error('untrusted-host');
    }
    if (isIP(host) === 0) {
        let addresses: readonly string[];
        try {
            addresses = await resolve(host);
        } catch {
            throw new Error('unresolvable-host');
        }
        if (addresses.some(isPrivateAddress)) {
            throw new Error('untrusted-host');
        }
    }

    return url.origin;
}
