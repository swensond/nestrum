<script lang="ts">
import { withNext } from '$lib/return-to.js';
import { TwoFactorClient } from '$lib/two-factor-client.js';
import type { PageProps } from './$types';

let { data }: PageProps = $props();
let message = $state('');
let pending = $state(false);
const client = new TwoFactorClient();
const stale = $derived(data.admin.status === 'two-factor');

async function verify(event: SubmitEvent) {
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
        // A full navigation picks up the new session cookie and reloads the admin state.
        window.location.assign(data.next);
        return;
    }
    message = result.message;
    pending = false;
}

async function signInAgain() {
    pending = true;
    await client.signOut();
    window.location.assign(data.next);
}
</script>

<svelte:head><title>Two-factor verification</title></svelte:head>
<h1>Two-factor verification</h1>
{#if stale}
    <p>Your administration verification is out of date. Sign in again and enter a code from your authenticator app.</p>
    <button type="button" disabled={pending} onclick={signInAgain}>Sign in again</button>
{:else}
    <p>Enter the 6-digit code from your authenticator app to open administration.</p>
    {#if message}<p role="alert">{message}</p>{/if}
    <form method="POST" onsubmit={verify}>
        <label>
            Verification code
            <input name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]*" maxlength="16" required disabled={pending} />
        </label>
        <button type="submit" disabled={pending}>Verify</button>
    </form>
    <p><a href={withNext('/admin/auth/recovery', data.next)}>Use a recovery code instead</a></p>
{/if}
