<script lang="ts">
import type { AuthState } from '@nestrum/web/client';
import { onMount } from 'svelte';
import { api, auth } from './nestrum';

// Public config arrives as a prop so the server render and the hydrating client agree.
let { publicEnv }: { publicEnv: Readonly<Record<string, string>> } = $props();
let session = $state<AuthState>({ status: 'loading', user: undefined, error: undefined });
let email = $state('');
let password = $state('');
let failure = $state('');
let apiStatus = $state('not requested');

onMount(() => {
    const stop = auth.state.subscribe((next) => (session = next));
    void auth.refresh();

    return stop;
});

async function signIn(event: SubmitEvent) {
    event.preventDefault();
    failure = '';
    try {
        await auth.signIn({ email, password });
    } catch (error) {
        failure = error instanceof Error ? error.message : 'Sign-in failed.';
    }
}

async function probe() {
    try {
        await api.get('/openapi.json');
        apiStatus = 'ok';
    } catch (error) {
        apiStatus = error instanceof Error ? error.message : 'failed';
    }
}
</script>

<main>
    <h1 id="title">Example consumer app</h1>
    <p id="site">site: {publicEnv.site ?? 'unset'}</p>
    {#if session.status === 'loading'}
        <p>Loading…</p>
    {:else if session.status === 'authenticated'}
        <p id="who">Signed in as {session.user.email}</p>
        <button onclick={() => auth.signOut()}>Sign out</button>
    {:else}
        <form onsubmit={signIn}>
            <input name="email" type="email" bind:value={email} placeholder="Email" />
            <input name="password" type="password" bind:value={password} placeholder="Password" />
            <button type="submit">Sign in</button>
            {#if failure}<p role="alert">{failure}</p>{/if}
        </form>
    {/if}
    <button onclick={probe}>Ping public API</button>
    <p id="api-status">API: {apiStatus}</p>
</main>
