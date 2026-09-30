import { CliError } from './cli.errors.js';
import type { CliArguments, DatabaseCommand } from './cli.types.js';

export const CLI_HELP = `Usage: nestrum db <generate|migrate|status> [options]
  --config <path>      Application config module (default nestrum.config.ts)
  --database <name>    Named database (default default)
  --name <slug>        Migration name (with migrate --plan)
  --plan              Plan a migration offline without applying it
  --json              Emit machine-readable output
  --confirm <token>   Grant Prisma migration consent explicitly (repeatable)
  --help              Show help
Generate emits contracts/types. Migrate applies reviewed migrations; --plan creates them.
Status reports the migration path from the live database marker.`;

export function parseCliArguments(args: readonly string[]): CliArguments {
    const [group, command, ...options] = args;
    if (group !== 'db' || !['generate', 'migrate', 'status'].includes(command ?? '')) {
        throw new CliError('CLI_ARGUMENT_INVALID', 'Expected db generate, db migrate, or db status.');
    }
    const values = new Map<string, string>();
    const flags = new Set<string>();
    const confirmations: string[] = [];
    for (let index = 0; index < options.length; index++) {
        const option = options[index] ?? '';
        if (option === '--confirm') {
            const token = options[++index];
            if (!token?.trim() || token.startsWith('--')) {
                throw new CliError('CLI_ARGUMENT_INVALID', 'Missing consent token.');
            }
            confirmations.push(token);
            continue;
        }
        if (['--plan', '--json'].includes(option)) {
            if (flags.has(option)) {
                throw new CliError('CLI_ARGUMENT_INVALID', `Duplicate option ${option}.`);
            }
            flags.add(option);
            continue;
        }
        if (!['--config', '--database', '--name'].includes(option) || values.has(option)) {
            throw new CliError('CLI_ARGUMENT_INVALID', `Unknown or repeated option ${option}.`);
        }
        const value = options[++index];
        if (!value || value.startsWith('--') || !value.trim()) {
            throw new CliError('CLI_ARGUMENT_INVALID', `Missing value for ${option}.`);
        }
        values.set(option, value);
    }
    const name = values.get('--name');
    if (
        (flags.has('--plan') && command !== 'migrate') ||
        (confirmations.length > 0 && (command !== 'migrate' || flags.has('--plan'))) ||
        (name !== undefined && (!flags.has('--plan') || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)))
    ) {
        throw new CliError('CLI_ARGUMENT_INVALID', '--name requires migrate --plan and a safe name slug.');
    }

    return {
        command: command as DatabaseCommand,
        config: values.get('--config') ?? 'nestrum.config.ts',
        database: values.get('--database') ?? 'default',
        ...(name === undefined ? {} : { name }),
        plan: flags.has('--plan'),
        json: flags.has('--json'),
        ...(confirmations.length ? { confirm: confirmations } : {}),
    };
}
