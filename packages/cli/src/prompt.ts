import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { CliError } from './cli.errors.js';

/** Reads one line from the terminal without echoing it. */
function readHidden(question: string): Promise<string> {
    return new Promise((resolve, reject) => {
        process.stderr.write(question);
        const muted = new Writable({ write: (_chunk, _encoding, callback) => callback() });
        const reader = createInterface({ input: process.stdin, output: muted, terminal: true });
        reader.once('line', (line) => {
            reader.close();
            process.stderr.write('\n');
            resolve(line);
        });
        reader.once('close', () => reject(new CliError('CLI_ARGUMENT_INVALID', 'No password was entered.')));
    });
}

/** Prompts twice and requires both entries to match. Only available on an interactive terminal. */
export async function promptNewPassword(): Promise<string> {
    if (!process.stdin.isTTY) {
        throw new CliError(
            'CLI_ARGUMENT_INVALID',
            'Set NESTRUM_ADMIN_PASSWORD, or run in a terminal to be prompted for the password.',
        );
    }
    const first = await readHidden('Password: ');
    const second = await readHidden('Repeat password: ');
    if (first !== second) {
        throw new CliError('CLI_ARGUMENT_INVALID', 'The passwords did not match.');
    }

    return first;
}
