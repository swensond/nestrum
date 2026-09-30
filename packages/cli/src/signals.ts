export type ShutdownSignals = {
    on(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
    off(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
};

export function installShutdownSignals(
    target: { shutdown(): Promise<void> },
    options: { source?: ShutdownSignals; onError?: (error: unknown) => void; onRepeat?: () => void } = {},
): () => void {
    const source = options.source ?? process;
    let pending = false;
    const shutdown = () => {
        if (pending) {
            options.onRepeat?.();

            return;
        }
        pending = true;
        void target.shutdown().catch((error) => {
            if (options.onError) {
                try {
                    options.onError(error);
                } catch {
                    process.exitCode = 1;
                }
            } else {
                process.exitCode = 1;
                console.error('Nestrum shutdown failed.', error);
            }
        });
    };
    source.on('SIGINT', shutdown);
    source.on('SIGTERM', shutdown);

    return () => {
        source.off('SIGINT', shutdown);
        source.off('SIGTERM', shutdown);
    };
}
