import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), 'nestrum-cli-build-'));
const bin = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
const configPath = join(directory, 'nestrum.config.ts');
const core = import.meta.resolve('@nestrum/core');
const cli = import.meta.resolve('@nestrum/cli');
await writeFile(
    configPath,
    `import { defineApplication } from ${JSON.stringify(core)};
import { defineCliConfig } from ${JSON.stringify(cli)};
export default defineCliConfig({
    application: defineApplication({
        apps: [{ name: 'models', prismaSource: ${JSON.stringify({ default: 'model Project {\n id Int @id\n name String\n}\n', documents: 'model Article {\n id ObjectId @id @map("_id")\n name String\n}\n' })} }],
        databases: {
            default: { kind: 'prisma', provider: 'postgresql', connection: 'postgresql://user:secret@127.0.0.1:1/test' },
            documents: { kind: 'prisma', provider: 'mongodb', connection: 'mongodb://127.0.0.1:1/test' }
        }
    }),
    timeoutMs: 5000
});\n`,
);
const run = (args) =>
    execute(process.execPath, [bin, ...args, '--config', configPath], { cwd: directory, timeout: 15_000 });

try {
    assert.ok((await execute(process.execPath, [bin, '--help'])).stdout.includes('db <generate|migrate|status>'));
    for (const database of ['default', 'documents']) {
        const generated = JSON.parse((await run(['db', 'generate', '--database', database, '--json'])).stdout);
        assert.equal(generated.database, database);
        assert.ok(
            (await readFile(generated.contract, 'utf8')).includes(database === 'default' ? 'Project' : 'Article'),
        );
        assert.ok((await readFile(generated.types, 'utf8')).length > 0);
        assert.deepEqual(await readdir(generated.directory), [database]);
        const plan = await run(['db', 'migrate', '--database', database, '--plan', '--name', 'initial', '--json']);
        assert.ok(plan.stdout.length > 0);
        assert.ok((await readdir(join(directory, 'prisma/migrations', database))).length > 0);
    }
    const status = await run(['db', 'status']).then(
        () => {
            throw new Error('Unreachable database must fail status.');
        },
        (error) => error,
    );
    assert.ok(status.code > 0);
    assert.ok(status.stderr.includes('CLI_DELEGATE_FAILED'));
    assert.ok(!status.stderr.includes('user:secret'));
    const unknown = await run(['db', 'generate', '--database', 'missing']).then(
        () => {
            throw new Error('Unknown database must fail.');
        },
        (error) => error,
    );
    assert.equal(unknown.code, 1);
    assert.ok(unknown.stderr.includes('DATABASE_NOT_FOUND'));
    console.log(
        'Compiled Nestrum CLI: TS config loading, SQL/Mongo contract generation, offline migration plans, database selection and safe delegated failures passed.',
    );
} finally {
    await rm(directory, { recursive: true, force: true });
}
