import { defineConfig } from '@nestrum/cli';
import { createExample } from './src/application.mjs';

// Connections and secrets come from the environment; `nestrum build` and `nestrum serve` need the same values.
// AUTH_SECRET, INTEGRATION_POSTGRES_URL, INTEGRATION_MONGO_URL, INTEGRATION_IDENTITY_URL, and optionally BASE_URL
// (default http://127.0.0.1:$PORT, with PORT defaulting to 3100) are read here.
export const example = createExample({
    baseURL: process.env.BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3100}`,
    connections: {
        default: process.env.INTEGRATION_POSTGRES_URL,
        documents: process.env.INTEGRATION_MONGO_URL,
        identity: process.env.INTEGRATION_IDENTITY_URL,
    },
});

export default defineConfig({
    application: example.application,
    // Prisma 8 allows one database facade per package, so each provider emits inside its own sibling package.
    contractDirs: {
        default: '../example-postgres/.nestrum/contracts',
        identity: '../example-postgres/.nestrum/contracts',
        documents: '../example-mongo/.nestrum/contracts',
    },
    // Used by `nestrum db ...`; kept apart from the contracts written by `nestrum build`.
    outputDir: process.env.INTEGRATION_OUTPUT_DIR ?? '.nestrum/db-contracts',
    migrationsDir: process.env.INTEGRATION_MIGRATIONS_DIR ?? '.nestrum/migrations',
    server: { port: 3100 },
    timeoutMs: 30000,
});
