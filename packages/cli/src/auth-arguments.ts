import { CliError } from './cli.errors.js';

export type AuthCommand = 'create-admin';
export type AuthArguments = {
    readonly command: AuthCommand;
    readonly config?: string;
    readonly email: string;
    readonly name?: string;
    readonly promote: boolean;
};

export const AUTH_HELP = `Usage: nestrum auth create-admin --email <email> [options]
  --email <email>     Address of the administrator to create
  --name <name>       Display name (default: the part of the email before @)
  --promote           Make an existing account an administrator instead of failing
  --config <path>     Configuration module (default nestrum.config.ts)
Reads the password from NESTRUM_ADMIN_PASSWORD, or prompts for it on a terminal. It is never accepted as an argument.
Runs against a previous \`nestrum build\` and never builds, generates, or migrates. Administrators are created only here;
they promote and demote staff in the admin interface.`;

export function parseAuthArguments(args: readonly string[]): AuthArguments {
    const [group, command, ...options] = args;
    if (group !== 'auth' || command !== 'create-admin') {
        throw new CliError('CLI_ARGUMENT_INVALID', 'Expected auth create-admin.');
    }
    const values = new Map<string, string>();
    let promote = false;
    for (let index = 0; index < options.length; index++) {
        const option = options[index] ?? '';
        if (option === '--promote') {
            if (promote) {
                throw new CliError('CLI_ARGUMENT_INVALID', 'Duplicate option --promote.');
            }
            promote = true;
            continue;
        }
        if (!['--email', '--name', '--config'].includes(option) || values.has(option)) {
            throw new CliError('CLI_ARGUMENT_INVALID', `Unknown or repeated option ${option}.`);
        }
        const value = options[++index];
        if (!value || value.startsWith('--') || !value.trim()) {
            throw new CliError('CLI_ARGUMENT_INVALID', `Missing value for ${option}.`);
        }
        values.set(option, value);
    }
    const email = values.get('--email');
    if (email === undefined) {
        throw new CliError('CLI_ARGUMENT_INVALID', '--email is required.');
    }
    const name = values.get('--name');
    const config = values.get('--config');

    return {
        command: 'create-admin',
        email,
        ...(name === undefined ? {} : { name }),
        ...(config === undefined ? {} : { config }),
        promote,
    };
}
