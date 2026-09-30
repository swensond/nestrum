<script lang="ts">
import type { PageProps } from './$types';

type Shown = {
    step?: 'confirm' | 'retry' | 'done';
    next?: string;
    secret?: string;
    otpauthUri?: string;
    recoveryCodes?: readonly string[];
    message?: string;
};

let { data, form }: PageProps = $props();
// Action results are a union of success and failure payloads; read them through one optional-field view.
const shown = $derived((form ?? {}) as Shown);
const next = $derived(shown.next ?? data.next);
</script>

<svelte:head><title>Set up two-factor authentication</title></svelte:head>
<h1>Set up two-factor authentication</h1>
{#if shown.message}<p role="alert">{shown.message}</p>{/if}
{#if data.admin.status !== 'two-factor' && shown.step !== 'done'}
    {#if data.admin.status === 'ready'}
        <p>Two-factor authentication is active for this session.</p>
        <p><a href={data.next}>Continue to administration</a></p>
    {:else}
        <p>Sign in to continue.</p>
    {/if}
{:else if shown.step === 'done'}
    <h2>Save your recovery codes</h2>
    <p>Each code works once if you lose access to your authenticator. They are shown only now and cannot be retrieved later.</p>
    <ul aria-label="Recovery codes">
        {#each shown.recoveryCodes ?? [] as code (code)}
            <li><code>{code}</code></li>
        {/each}
    </ul>
    <p><a href={next}>I have saved these codes — continue</a></p>
{:else if shown.step === 'confirm' || shown.step === 'retry'}
    {#if shown.step === 'confirm'}
        <p>
            Add this account to your authenticator app using the key below, or
            <a href={shown.otpauthUri}>open it in an authenticator app</a>.
        </p>
        <p>Setup key: <code>{shown.secret}</code></p>
    {:else}
        <form method="POST" action="?/start">
            <input type="hidden" name="next" value={next} />
            <button type="submit">Start over with a new key</button>
        </form>
    {/if}
    <form method="POST" action="?/confirm">
        <input type="hidden" name="next" value={next} />
        <label>
            Verification code
            <input name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]*" maxlength="16" required />
        </label>
        <button type="submit">Activate two-factor authentication</button>
    </form>
{:else}
    <p>Administration requires two-factor authentication. Set it up with an authenticator app.</p>
    <form method="POST" action="?/start">
        <input type="hidden" name="next" value={data.next} />
        <button type="submit">Begin setup</button>
    </form>
{/if}
