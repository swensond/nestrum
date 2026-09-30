import { CliError } from './cli.errors.js';

export type RuntimeCommand = 'dev' | 'build' | 'serve';
export type RuntimeArguments = {
    readonly command: RuntimeCommand;
    readonly config?: string;
    readonly host?: string;
    readonly port?: number;
    /** `nestrum dev --feature name=true|false`: process-local overrides that never touch storage. */
    readonly features?: Readonly<Record<string, boolean>>;
};

export const RUNTIME_COMMANDS: readonly string[] = ['dev', 'build', 'serve'];

export const RUNTIME_HELP = `Usage: nestrum <dev|build|serve> [options]
  dev                 Generate, start, watch, and restart the application
  build               Validate the application and write the production build (.nestrum/)
  serve               Serve a previous build; never builds, watches, or migrates
  --config <path>     Configuration module (default nestrum.config.ts)
  --host <host>       Listen host (dev, serve; default 127.0.0.1)
  --port <port>       Listen port (dev, serve; default 3000)
  --feature <n>=<b>   Override a feature flag for this dev process only, e.g. newDashboard=true (repeatable)
Server option precedence: flag > HOST/PORT environment > nestrum.config.ts > default.`;

export function parseRuntimeArguments(args: readonly string[]): RuntimeArguments {
    const [command, ...options] = args;
    if (!RUNTIME_COMMANDS.includes(command ?? '')) {
        throw new CliError('CLI_ARGUMENT_INVALID', 'Expected dev, build, or serve.');
    }
    const values = new Map<string, string>();
    const features: Record<string, boolean> = {};
    for (let index = 0; index < options.length; index++) {
        const option = options[index] ?? '';
        const allowed =
            command === 'build'
                ? ['--config']
                : command === 'dev'
                  ? ['--config', '--host', '--port', '--feature']
                  : ['--config', '--host', '--port'];
        if (!allowed.includes(option) || (option !== '--feature' && values.has(option))) {
            throw new CliError('CLI_ARGUMENT_INVALID', `Unknown or repeated option ${option}.`);
        }
        const value = options[++index];
        if (!value || value.startsWith('--') || !value.trim()) {
            throw new CliError('CLI_ARGUMENT_INVALID', `Missing value for ${option}.`);
        }
        if (option === '--feature') {
            const match = /^([a-z][A-Za-z0-9]{0,63})=(true|false)$/.exec(value);
            if (!match) {
                throw new CliError(
                    'CLI_ARGUMENT_INVALID',
                    '--feature must look like newDashboard=true or newDashboard=false.',
                );
            }
            if (Object.hasOwn(features, match[1] as string)) {
                throw new CliError('CLI_ARGUMENT_INVALID', `Feature ${match[1]} is overridden twice.`);
            }
            features[match[1] as string] = match[2] === 'true';
            continue;
        }
        values.set(option, value);
    }
    const port = values.get('--port');
    if (port !== undefined && !/^\d{1,5}$/.test(port)) {
        throw new CliError('CLI_ARGUMENT_INVALID', '--port must be an integer between 0 and 65535.');
    }
    const config = values.get('--config');
    const host = values.get('--host');

    return {
        command: command as RuntimeCommand,
        ...(config === undefined ? {} : { config }),
        ...(host === undefined ? {} : { host }),
        ...(port === undefined ? {} : { port: Number(port) }),
        ...(Object.keys(features).length === 0 ? {} : { features: Object.freeze(features) }),
    };
}
