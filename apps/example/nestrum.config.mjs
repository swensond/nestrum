import { resolve } from 'node:path';
import { defineCliConfig, parseCliArguments } from '@nestrum/cli';
import { createExample, providerDirectory, ROOT_DIR } from './src/application.mjs';

const example = createExample({
    connections: {
        default: process.env.INTEGRATION_POSTGRES_URL,
        documents: process.env.INTEGRATION_MONGO_URL,
        identity: process.env.INTEGRATION_IDENTITY_URL,
    },
    outputDir: process.env.INTEGRATION_OUTPUT_DIR,
});

const database = parseCliArguments(process.argv.slice(2)).database;
export default defineCliConfig({
    application: example.application,
    rootDir: ROOT_DIR,
    outputDir: resolve(providerDirectory(database), process.env.INTEGRATION_OUTPUT_DIR ?? '.nestrum/contracts'),
    migrationsDir: resolve(
        providerDirectory(database),
        process.env.INTEGRATION_MIGRATIONS_DIR ?? '.nestrum/migrations',
    ),
    timeoutMs: 30000,
});
