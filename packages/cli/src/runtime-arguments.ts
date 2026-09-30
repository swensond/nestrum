import { CliError } from './cli.errors.js';

export type RuntimeCommand = 'dev' | 'build' | 'serve';
export type RuntimeArguments = {
    readonly command: RuntimeCommand;
    readonly config?: string;
    readonly host?: string;
    readonly port?: number;
};

export const RUNTIME_COMMANDS: readonly string[] = ['dev', 'build', 'serve'];

export const RUNTIME_HELP = `Usage: nestrum <dev|build|serve> [options]
  dev                 Generate, start, watch, and restart the application
  build               Validate the application and write the production build (.nestrum/)
  serve               Serve a previous build; never builds, watches, or migrates
  --config <path>     Configuration module (default nestrum.config.ts)
  --host <host>       Listen host (dev, serve; default 127.0.0.1)
  --port <port>       Listen port (dev, serve; default 3000)
Server option precedence: flag > HOST/PORT environment > nestrum.config.ts > default.`;

export function parseRuntimeArguments(args: readonly string[]): RuntimeArguments {
    const [command, ...options] = args;
    if (!RUNTIME_COMMANDS.includes(command ?? '')) {
        throw new CliError('CLI_ARGUMENT_INVALID', 'Expected dev, build, or serve.');
    }
    const values = new Map<string, string>();
    for (let index = 0; index < options.length; index++) {
        const option = options[index] ?? '';
        const allowed = command === 'build' ? ['--config'] : ['--config', '--host', '--port'];
        if (!allowed.includes(option) || values.has(option)) {
            throw new CliError('CLI_ARGUMENT_INVALID', `Unknown or repeated option ${option}.`);
        }
        const value = options[++index];
        if (!value || value.startsWith('--') || !value.trim()) {
            throw new CliError('CLI_ARGUMENT_INVALID', `Missing value for ${option}.`);
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
    };
}
