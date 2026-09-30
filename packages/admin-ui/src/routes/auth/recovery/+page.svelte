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
    const result = await client.verifyBackupCode(code);
    if (result.ok) {
        window.location.assign(data.next);
        return;
    }
    message = result.message;
    pending = false;
}
</script>

<svelte:head><title>Use a recovery code</title></svelte:head>
<h1>Use a recovery code</h1>
{#if stale}
    <p>Your administration verification is out of date. <a href={data.next}>Sign in again</a>, then use a recovery code.</p>
{:else}
    <p>Enter one of your saved recovery codes. Each code works once.</p>
    {#if message}<p role="alert">{message}</p>{/if}
    <form method="POST" onsubmit={verify}>
        <label>
            Recovery code
            <input name="code" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="64" required disabled={pending} />
        </label>
        <button type="submit" disabled={pending}>Verify recovery code</button>
    </form>
    <p><a href={withNext('/admin/auth/2fa', data.next)}>Use an authenticator code instead</a></p>
{/if}
