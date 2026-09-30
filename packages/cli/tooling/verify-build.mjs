import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
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
    // nestrum build -> nestrum serve (real process) -> HTTP -> signal -> graceful exit, for both signals.
    const built = await execute(process.execPath, [bin, 'build', '--config', configPath], {
        cwd: directory,
        timeout: 60_000,
    });
    assert.ok(built.stdout.includes('Built'));
    const missing = await execute(process.execPath, [bin, 'serve', '--config', join(directory, 'absent', 'x.ts')], {
        cwd: directory,
    }).then(
        () => {
            throw new Error('Serving without a build must fail.');
        },
        (error) => error,
    );
    assert.ok(missing.stderr.includes('nestrum build'));
    for (const signal of ['SIGTERM', 'SIGINT']) {
        const child = spawn(process.execPath, [bin, 'serve', '--config', configPath, '--port', '0'], {
            cwd: directory,
            env: { ...process.env, NESTRUM_ENV: undefined },
        });
        const exited = new Promise((resolve) => child.once('exit', (code, received) => resolve({ code, received })));
        let output = '';
        const url = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`serve did not start: ${output}`)), 30_000);
            child.stdout.on('data', (chunk) => {
                output += chunk;
                const match = /listening on (http:\/\/\S+)/.exec(output);
                if (match) {
                    clearTimeout(timer);
                    resolve(match[1]);
                }
            });
            child.stderr.on('data', (chunk) => {
                output += chunk;
            });
        });
        assert.equal((await fetch(`${url}/__nestrum/health`)).status, 200);
        assert.equal((await fetch(`${url}/__nestrum/ready`)).status, 200);
        assert.equal((await fetch(`${url}/api/openapi.json`)).status, 404);
        child.kill(signal);
        const result = await exited;
        assert.deepEqual(result, { code: 0, received: null }, `${signal} must exit gracefully: ${output}`);
        await assert.rejects(fetch(`${url}/__nestrum/health`));
    }
    console.log(
        'Compiled Nestrum CLI: TS config loading, SQL/Mongo contract generation, offline migration plans, database selection, safe delegated failures, and build → serve → health → SIGTERM/SIGINT graceful exit passed.',
    );
} finally {
    await rm(directory, { recursive: true, force: true });
}
