import { createAdminShell } from '@nestrum/admin-ui/node';
import { createHonoRuntime } from '@nestrum/hono';
import { createExample } from './application.mjs';
import { createFetchHost } from './host.mjs';

let runtime;
const host = await createFetchHost(
    (request) => (runtime ? runtime.fetch(request) : new Response(null, { status: 503 })),
    Number(process.env.PORT ?? 3100),
);
try {
    const { application } = createExample({
        baseURL: host.baseURL,
        connections: {
            default: process.env.INTEGRATION_POSTGRES_URL,
            documents: process.env.INTEGRATION_MONGO_URL,
            identity: process.env.INTEGRATION_IDENTITY_URL,
        },
    });
    runtime = createHonoRuntime({ application, adminUi: await createAdminShell(), stopTraffic: host.stop });
    await runtime.start();
    console.log(`Example listening at ${host.baseURL}`);
    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.once(signal, () =>
            runtime.shutdown().catch((error) => {
                console.error(error);
                process.exitCode = 1;
            }),
        );
    }
} catch (error) {
    await runtime?.shutdown();
    host.stop();
    throw error;
}
