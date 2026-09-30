import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Top-level path segments owned by the framework. The consumer UI can never serve or shadow them. */
export const RESERVED_NAMESPACES = ['api', 'admin', '__admin', '__nestrum'] as const;

export function isReservedPath(pathname: string): boolean {
    const first = pathname.split('/')[1] ?? '';

    return (RESERVED_NAMESPACES as readonly string[]).includes(first);
}

export type RouteCollision = { readonly file: string; readonly namespace: string };

/**
 * Consumer routes are the top-level entries of `<root>/src/routes` and `<root>/public`. An entry (ignoring its
 * extension, and SvelteKit-style group/param decorations) that names a framework namespace is a collision.
 */
export async function findRouteCollisions(root: string): Promise<RouteCollision[]> {
    const collisions: RouteCollision[] = [];
    for (const directory of ['src/routes', 'public']) {
        const entries = await readdir(join(root, directory)).catch(() => [] as string[]);
        for (const entry of entries) {
            const name = entry.replace(/\.[^.]+$/, '');
            const namespace = (RESERVED_NAMESPACES as readonly string[]).find((reserved) => reserved === name);
            if (namespace !== undefined) {
                collisions.push({ file: `${directory}/${entry}`, namespace });
            }
        }
    }

    return collisions;
}

export function describeCollisions(collisions: readonly RouteCollision[]): string {
    return collisions
        .map(
            ({ file, namespace }) =>
                `${file} shadows the framework namespace "/${namespace}". Rename it; /${RESERVED_NAMESPACES.join(', /')} are reserved.`,
        )
        .join('\n');
}
