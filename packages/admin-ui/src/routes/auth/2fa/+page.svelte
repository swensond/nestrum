<script lang="ts">
import { withNext } from '$lib/return-to.js';
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();
</script>

<svelte:head><title>Two-factor verification</title></svelte:head>
<h1>Two-factor verification</h1>
{#if data.admin.status === 'two-factor'}
    <p>Enter the 6-digit code from your authenticator app to open administration.</p>
    {#if form?.message}<p role="alert">{form.message}</p>{/if}
    <form method="POST">
        <input type="hidden" name="next" value={data.next} />
        <label>
            Verification code
            <input name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]*" maxlength="16" required />
        </label>
        <button type="submit">Verify</button>
    </form>
    <p><a href={withNext('/admin/auth/recovery', data.next)}>Use a recovery code instead</a></p>
{:else}
    <p>Sign in to continue.</p>
{/if}
