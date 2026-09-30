<script lang="ts">
import { withNext } from '$lib/return-to.js';
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();
</script>

<svelte:head><title>Use a recovery code</title></svelte:head>
<h1>Use a recovery code</h1>
{#if data.admin.status === 'two-factor'}
    <p>Enter one of your saved recovery codes. Each code works once.</p>
    {#if form?.message}<p role="alert">{form.message}</p>{/if}
    <form method="POST">
        <input type="hidden" name="next" value={data.next} />
        <label>
            Recovery code
            <input name="code" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="32" required />
        </label>
        <button type="submit">Verify recovery code</button>
    </form>
    <p><a href={withNext('/admin/auth/2fa', data.next)}>Use an authenticator code instead</a></p>
{:else}
    <p>Sign in to continue.</p>
{/if}
