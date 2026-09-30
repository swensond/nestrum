<script lang="ts">
import type { Snippet } from 'svelte';
import type { AdminShellState } from './metadata.js';
import { isAuthPath } from './return-to.js';
import { resourceHref } from './routes.js';

let {
    state: shellState,
    activePath = '/admin',
    loading = false,
    canManageUsers = false,
    onretry,
    ontwofactor,
    children,
}: {
    state: AdminShellState;
    activePath?: string;
    loading?: boolean;
    /** Show the user-access link; the API still authorizes every request. */
    canManageUsers?: boolean;
    onretry?: () => void | Promise<void>;
    /** Called when sign-in succeeded but a second factor must be verified before a session exists. */
    ontwofactor?: () => void | Promise<void>;
    children?: Snippet;
} = $props();
let pending = $state(false);
let sessionError = $state('');

async function signIn(event: SubmitEvent) {
    event.preventDefault();
    if (!(event.currentTarget instanceof HTMLFormElement) || pending) {
        return;
    }
    const form = event.currentTarget;
    const input = new FormData(form);
    const email = input.get('email');
    const password = input.get('password');
    if (typeof email !== 'string' || typeof password !== 'string') {
        return;
    }
    await authenticate('/api/auth/sign-in/email', { email, password });
    form.reset();
}

async function authenticate(path: string, body: object) {
    pending = true;
    sessionError = '';
    try {
        const response = await fetch(path, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            sessionError = 'Unable to update your session. Check your credentials and try again.';
            return;
        }
        const result: unknown = await response.json().catch(() => null);
        if (
            result &&
            typeof result === 'object' &&
            (result as { twoFactorRedirect?: unknown }).twoFactorRedirect === true
        ) {
            await ontwofactor?.();
            return;
        }
        await onretry?.();
    } catch {
        sessionError = 'Unable to connect. Please try again.';
    } finally {
        pending = false;
    }
}
</script>

<a class="skip" href="#admin-content">Skip to content</a>
<header>
    <a class="brand" href="/admin">Nestrum administration</a>
    {#if shellState.status === 'ready' || shellState.status === 'denied' || shellState.status === 'two-factor'}
        <button type="button" disabled={pending} onclick={() => authenticate('/api/auth/sign-out', {})}>Sign out</button>
    {/if}
</header>
<div class="layout">
    {#if shellState.status === 'ready' && !loading}
        <nav aria-label="Admin resources">
            <a href="/admin" aria-current={activePath === '/admin' || activePath === '/admin/' ? 'page' : undefined}>Overview</a>
            {#each shellState.resources as resource (resource.identity)}
                {@const href = resourceHref(resource)}
                <a {href} aria-current={activePath === href || activePath.startsWith(`${href}/`) ? 'page' : undefined}>{resource.label}</a>
            {/each}
            {#if canManageUsers}
                <a href="/admin/access" aria-current={activePath.startsWith('/admin/access') ? 'page' : undefined}>User access</a>
            {/if}
        </nav>
    {/if}
    <main id="admin-content" aria-busy={loading || pending} tabindex="-1">
        {#if sessionError}<p role="alert">{sessionError}</p>{/if}
        {#if loading}
            <p role="status">Loading administration…</p>
        {:else if shellState.status === 'ready' || shellState.status === 'two-factor' || (shellState.status === 'sign-in' && isAuthPath(activePath))}
            {#if children}{@render children()}{/if}
        {:else if shellState.status === 'sign-in'}
            <h1>Sign in</h1>
            <p>{shellState.message}</p>
            <form onsubmit={signIn}>
                <label>Email <input name="email" type="email" autocomplete="username" required disabled={pending} /></label>
                <label>Password <input name="password" type="password" autocomplete="current-password" required disabled={pending} /></label>
                <button type="submit" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button>
            </form>
        {:else}
            <h1>{shellState.status === 'denied' ? 'Access denied' : 'Administration unavailable'}</h1>
            <p role="alert">{shellState.message}</p>
            <button type="button" disabled={pending} onclick={() => onretry?.()}>Try again</button>
        {/if}
    </main>
</div>

<style>
    :global(body) { margin: 0; font-family: system-ui, sans-serif; color: #182331; background: #f7f9fc; }
    :global(a) { color: #174e86; }
    :global(button), :global(input) { font: inherit; padding: .55rem .7rem; }
    header { padding: 1rem 1.5rem; background: white; border-bottom: 1px solid #d9e1eb; display: flex; justify-content: space-between; gap: 1rem; align-items: center; }
    .brand { font-weight: 650; text-decoration: none; }
    .layout { display: flex; min-height: 80vh; }
    nav { min-width: 12rem; padding: 1.5rem; display: flex; flex-direction: column; gap: .75rem; border-right: 1px solid #d9e1eb; }
    nav a[aria-current] { font-weight: bold; }
    main { padding: 1.5rem; flex: 1; min-width: 0; }
    form { display: grid; gap: 1rem; max-width: 24rem; }
    label { display: grid; gap: .4rem; }
    .skip { position: absolute; left: -100vw; }
    .skip:focus { left: 1rem; top: .5rem; padding: .5rem; background: white; }
    @media (max-width: 640px) { .layout { flex-direction: column; } nav { border-right: none; border-bottom: 1px solid #d9e1eb; } }
</style>
