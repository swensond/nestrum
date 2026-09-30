import { defineConfig } from '@nestrum/cli';
import { createExample } from './src/application.mjs';

// Connections and secrets come from the environment; `nestrum build` and `nestrum serve` need the same values.
// AUTH_SECRET, INTEGRATION_POSTGRES_URL, and optionally BASE_URL (default http://127.0.0.1:$PORT, with PORT
// defaulting to 3100) are read here.
export const example = createExample({
    baseURL: process.env.BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3100}`,
    connection: process.env.INTEGRATION_POSTGRES_URL,
});

export default defineConfig({
    application: example.application,
    // Prisma 8 emits the database facade inside the package that depends on the provider.
    contractDir: '../example-postgres/.nestrum/contracts',
    // Used by `nestrum db ...`; kept apart from the contracts written by `nestrum build`.
    outputDir: process.env.INTEGRATION_OUTPUT_DIR ?? '.nestrum/db-contracts',
    migrationsDir: process.env.INTEGRATION_MIGRATIONS_DIR ?? '.nestrum/migrations',
    server: { port: 3100 },
    // The consumer UI is this application's own Vite/Svelte project; Nestrum builds and hosts it.
    web: {
        enabled: true,
        root: './src/web',
        publicEnv: { site: 'nestrum-example' },
        // Rendered on the server by src/entry-server.ts and hydrated in the browser.
        ssr: { entry: './src/entry-server.ts' },
    },
    timeoutMs: 30000,
});
