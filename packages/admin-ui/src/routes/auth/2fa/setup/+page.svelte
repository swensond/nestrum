<script lang="ts">
import { TwoFactorClient } from '$lib/two-factor-client.js';
import type { PageProps } from './$types';

let { data }: PageProps = $props();
let message = $state('');
let pending = $state(false);
let enrollment = $state<{ totpURI: string; secret: string; backupCodes: string[] } | undefined>();
let activated = $state(false);
const client = new TwoFactorClient();

async function begin(event: SubmitEvent) {
    event.preventDefault();
    if (!(event.currentTarget instanceof HTMLFormElement) || pending) {
        return;
    }
    const password = new FormData(event.currentTarget).get('password');
    if (typeof password !== 'string' || !password) {
        return;
    }
    pending = true;
    message = '';
    const result = await client.enable(password);
    if (result.ok) {
        enrollment = result.value;
    } else {
        message = result.message;
    }
    pending = false;
}

async function activate(event: SubmitEvent) {
    event.preventDefault();
    if (!(event.currentTarget instanceof HTMLFormElement) || pending) {
        return;
    }
    const code = new FormData(event.currentTarget).get('code');
    if (typeof code !== 'string' || !code.trim()) {
        return;
    }
    pending = true;
    message = '';
    const result = await client.verifyTotp(code);
    if (result.ok) {
        // Activation replaces the session with a verified one; the codes stay on screen until the user continues.
        activated = true;
    } else {
        message = result.message;
    }
    pending = false;
}
</script>

<svelte:head><title>Set up two-factor authentication</title></svelte:head>
<h1>Set up two-factor authentication</h1>
{#if message}<p role="alert">{message}</p>{/if}
{#if data.admin.status === 'sign-in'}
    <p><a href="/admin">Sign in</a> to set up two-factor authentication.</p>
{:else if activated && enrollment}
    <p>Two-factor authentication is now active.</p>
    <h2>Your recovery codes</h2>
    <p>Each code works once if you lose access to your authenticator. They are shown only on this page and cannot be retrieved later.</p>
    <ul aria-label="Recovery codes">
        {#each enrollment.backupCodes as code (code)}
            <li><code>{code}</code></li>
        {/each}
    </ul>
    <p><a href={data.next} data-sveltekit-reload>I have saved these codes — continue</a></p>
{:else if data.admin.status === 'ready'}
    <p>Two-factor authentication is active for this session.</p>
    <p><a href={data.next}>Continue to administration</a></p>
{:else if enrollment}
    <p>
        Add this account to your authenticator app using the key below, or
        <a href={enrollment.totpURI}>open it in an authenticator app</a>.
    </p>
    <p>Setup key: <code>{enrollment.secret}</code></p>
    <h2>Recovery codes</h2>
    <p>Save these now. They become valid when you activate two-factor authentication and are not shown again.</p>
    <ul aria-label="Recovery codes">
        {#each enrollment.backupCodes as code (code)}
            <li><code>{code}</code></li>
        {/each}
    </ul>
    <form method="POST" onsubmit={activate}>
        <label>
            Verification code
            <input name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]*" maxlength="16" required disabled={pending} />
        </label>
        <button type="submit" disabled={pending}>Activate two-factor authentication</button>
    </form>
{:else}
    <p>Administration requires two-factor authentication. Set it up with an authenticator app. Confirm your password to begin.</p>
    <form method="POST" onsubmit={begin}>
        <label>
            Password
            <input name="password" type="password" autocomplete="current-password" required disabled={pending} />
        </label>
        <button type="submit" disabled={pending}>Begin setup</button>
    </form>
{/if}
