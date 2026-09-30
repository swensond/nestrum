import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CliError } from './cli.errors.js';

export const MANIFEST_VERSION = 2;
export const BUILD_DIRECTORY = '.nestrum';
export const MANIFEST_FILE = 'manifest.json';

export type BuildManifest = {
    readonly manifestVersion: typeof MANIFEST_VERSION;
    readonly nestrumVersion: string;
    readonly builtAt: string;
    /** Package that provides the runtime adapter used by `serve`. */
    readonly runtime: { readonly adapter: string };
    /** Server entry, relative to the build directory, and its SHA-256 for tamper/staleness detection. */
    readonly entry: { readonly path: string; readonly sha256: string };
    readonly apps: readonly string[];
    readonly resources: number;
    readonly auth: boolean;
    /** The prebuilt admin shell package, resolved at serve time. `null` when the application has no admin. */
    readonly admin: { readonly package: string } | null;
    /** The built consumer UI (`<build>/web`); `null` when the application has none. */
    readonly web: {
        readonly directory: string;
        /** Normalized base path (`''` for the site root). */
        readonly basePath: string;
        /** The SSR bundle, relative to the build directory, when the UI renders on the server. */
        readonly ssr?: { readonly entry: string };
    } | null;
    /** `null` when no installed app contributes a Prisma schema. */
    readonly database: {
        readonly provider: string;
        /** Paths are relative to the build directory. */
        readonly contract: string;
        readonly metadata: string;
    } | null;
    readonly server: { readonly host?: string; readonly port?: number };
};

export const sha256 = (content: string | Uint8Array): string => createHash('sha256').update(content).digest('hex');

export function buildDirectory(root: string): string {
    return join(root, BUILD_DIRECTORY);
}

export async function readManifest(root: string, nestrumVersion: string): Promise<BuildManifest> {
    const directory = buildDirectory(root);
    let raw: string;
    try {
        raw = await readFile(join(directory, MANIFEST_FILE), 'utf8');
    } catch {
        throw new CliError('BUILD_NOT_FOUND', 'No production build found.\n\nRun:\n  nestrum build');
    }
    let manifest: BuildManifest;
    try {
        manifest = JSON.parse(raw) as BuildManifest;
    } catch {
        throw new CliError('BUILD_MANIFEST_INVALID', 'The production manifest is unreadable. Run:\n  nestrum build');
    }
    if (manifest?.manifestVersion !== MANIFEST_VERSION) {
        throw new CliError(
            'BUILD_INCOMPATIBLE',
            `The production build uses manifest version ${String(manifest?.manifestVersion)}; this Nestrum expects ${MANIFEST_VERSION}. Run:\n  nestrum build`,
        );
    }
    if (manifest.nestrumVersion !== nestrumVersion) {
        throw new CliError(
            'BUILD_INCOMPATIBLE',
            `The production build was created by Nestrum ${manifest.nestrumVersion}, but ${nestrumVersion} is installed. Run:\n  nestrum build`,
        );
    }
    if (typeof manifest.entry?.path !== 'string' || typeof manifest.entry.sha256 !== 'string') {
        throw new CliError('BUILD_MANIFEST_INVALID', 'The production manifest is incomplete. Run:\n  nestrum build');
    }
    let entry: Buffer;
    try {
        entry = await readFile(join(directory, manifest.entry.path));
    } catch {
        throw new CliError('BUILD_INCOMPLETE', 'The production server entry is missing. Run:\n  nestrum build');
    }
    if (sha256(entry) !== manifest.entry.sha256) {
        throw new CliError(
            'BUILD_STALE',
            'The production server entry does not match its manifest. Run:\n  nestrum build',
        );
    }
    if (manifest.web) {
        try {
            await readFile(join(directory, manifest.web.directory, 'index.html'));
        } catch {
            throw new CliError('BUILD_INCOMPLETE', 'The consumer UI build is missing. Run:\n  nestrum build');
        }
        if (manifest.web.ssr) {
            try {
                await readFile(join(directory, manifest.web.ssr.entry));
            } catch {
                throw new CliError('BUILD_INCOMPLETE', 'The consumer SSR bundle is missing. Run:\n  nestrum build');
            }
        }
    }
    if (manifest.database) {
        for (const artifact of [manifest.database.contract, manifest.database.metadata]) {
            try {
                await readFile(join(directory, artifact));
            } catch {
                throw new CliError('BUILD_INCOMPLETE', `Build artifact ${artifact} is missing. Run:\n  nestrum build`);
            }
        }
    }

    return manifest;
}

/** The installed CLI version, read from its own package manifest. */
export async function cliVersion(): Promise<string> {
    const raw = await readFile(new URL('../package.json', import.meta.url), 'utf8');

    return (JSON.parse(raw) as { version: string }).version;
}
