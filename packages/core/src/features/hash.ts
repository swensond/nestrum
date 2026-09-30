/** Version of the bucketing scheme. Changing the hash or its input format requires a new version. */
export const ROLLOUT_HASH_VERSION = 'v1';
export const ROLLOUT_BUCKETS = 10_000;

/** MurmurHash3 (x86, 32-bit) over the UTF-8 bytes of `text`. Pure and identical in every runtime. */
export function murmur3(text: string, seed = 0): number {
    const bytes = new TextEncoder().encode(text);
    const length = bytes.length;
    let hash = seed >>> 0;
    const blocks = length - (length % 4);
    for (let index = 0; index < blocks; index += 4) {
        let k =
            (bytes[index] as number) |
            ((bytes[index + 1] as number) << 8) |
            ((bytes[index + 2] as number) << 16) |
            ((bytes[index + 3] as number) << 24);
        k = Math.imul(k, 0xcc9e2d51);
        k = (k << 15) | (k >>> 17);
        k = Math.imul(k, 0x1b873593);
        hash ^= k;
        hash = (hash << 13) | (hash >>> 19);
        hash = (Math.imul(hash, 5) + 0xe6546b64) | 0;
    }
    const remaining = length % 4;
    if (remaining > 0) {
        let tail = 0;
        if (remaining === 3) {
            tail ^= (bytes[blocks + 2] as number) << 16;
        }
        if (remaining >= 2) {
            tail ^= (bytes[blocks + 1] as number) << 8;
        }
        tail ^= bytes[blocks] as number;
        tail = Math.imul(tail, 0xcc9e2d51);
        tail = (tail << 15) | (tail >>> 17);
        tail = Math.imul(tail, 0x1b873593);
        hash ^= tail;
    }
    hash ^= length;
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x85ebca6b);
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 0xc2b2ae35);
    hash ^= hash >>> 16;

    return hash >>> 0;
}

/**
 * Deterministic bucket in `[0, 10000)` for a flag and stable subject key. The same inputs give the same bucket in
 * every process, so a rollout only moves when its configured percentage changes.
 */
export function rolloutBucket(flag: string, stableKey: string): number {
    return murmur3(`${ROLLOUT_HASH_VERSION}\u0000${flag}\u0000${stableKey}`) % ROLLOUT_BUCKETS;
}
