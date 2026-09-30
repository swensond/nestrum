import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

/** @returns {import('@sveltejs/kit').Adapter} */
export default function adapter() {
    return {
        name: 'nestrum-fetch',
        async adapt(builder) {
            const output = 'dist';
            builder.rimraf(`${output}/server`);
            builder.rimraf(`${output}/assets`);
            builder.writeServer(`${output}/server`);
            builder.writeClient(`${output}/assets`);
            await mkdir(output, { recursive: true });
            const assets = await readdir(`${output}/assets`, { recursive: true, withFileTypes: true });
            const files = assets
                .filter((entry) => entry.isFile() && !entry.name.startsWith('.') && !entry.parentPath.includes('/.'))
                .map((entry) => relative(`${output}/assets`, join(entry.parentPath, entry.name)));
            await writeFile(
                `${output}/manifest.js`,
                `export const manifest = ${builder.generateManifest({ relativePath: './server' })};\nexport const assets = ${JSON.stringify(files)};\n`,
            );
        },
    };
}
