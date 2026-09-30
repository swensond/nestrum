<script lang="ts">
import { API_KEY_PAGE_SIZE } from '$lib/api-keys-shared.js';
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();
const next = $derived(
    data.page && data.offset + API_KEY_PAGE_SIZE < data.page.total ? data.offset + API_KEY_PAGE_SIZE : null,
);
const previous = $derived(data.offset > 0 ? Math.max(0, data.offset - API_KEY_PAGE_SIZE) : null);
const when = (value: string | null) => (value ? value.replace('T', ' ').slice(0, 16) : '—');
</script>

<svelte:head><title>API keys</title></svelte:head>
<h1>API keys</h1>
<p>Keys let other systems call resource APIs that accept <code>X-API-Key</code>. A key acts as its own identity with only the scopes you grant; it never signs in as its owner.</p>
{#if form?.message}<p role="alert">{form.message}</p>{/if}
{#if form && 'revoked' in form && form.revoked}<p role="status">Key revoked. It can no longer be used.</p>{/if}
{#if form && 'revealed' in form && form.revealed}
    <section aria-labelledby="reveal-title">
        <h2 id="reveal-title">Copy the key for “{form.revealed.name}” now</h2>
        <p><strong>This key will not be shown again.</strong> Store it in a secret manager; only its first characters ({form.revealed.start}…) are kept for recognition.</p>
        <p><code data-testid="api-key-secret">{form.revealed.secret}</code></p>
    </section>
{/if}
{#if data.message}
    <p role="alert">{data.message}</p>
{:else if data.page}
    {#if data.capabilities?.create}
        <h2>Create a key</h2>
        <form method="POST" action="?/create">
            <label>Name <input name="name" required maxlength="64" /></label>
            <label>Owner user ID <input name="ownerId" required maxlength="128" autocomplete="off" /></label>
            <label>Scopes <input name="scopes" placeholder="projects:read projects:write" maxlength="4096" autocomplete="off" /></label>
            <label>Expires in days (blank for the default) <input name="expiresInDays" inputmode="numeric" pattern="[1-9][0-9]*" /></label>
            <label>Rate limit requests <input name="rateLimitRequests" inputmode="numeric" pattern="[1-9][0-9]*" /></label>
            <label>per seconds <input name="rateLimitWindowSeconds" inputmode="numeric" pattern="[1-9][0-9]*" /></label>
            <label><input type="checkbox" name="rateLimitDisabled" /> No rate limit</label>
            <button type="submit">Create key</button>
        </form>
    {/if}
    <h2>Keys</h2>
    {#if data.page.keys.length === 0}
        <p>No API keys yet.</p>
    {:else}
        <table>
            <thead>
                <tr><th>Name</th><th>Key</th><th>Owner</th><th>Scopes</th><th>Status</th><th>Expires</th><th>Last used</th><th>Rate limit</th><th>Actions</th></tr>
            </thead>
            <tbody>
                {#each data.page.keys as key (key.id)}
                    <tr>
                        <td>{key.name}</td>
                        <td><code>{key.start}…</code></td>
                        <td><code>{key.owner.id}</code></td>
                        <td>{key.scopes.length ? key.scopes.join(', ') : 'none'}</td>
                        <td>{key.status}{key.status === 'revoked' && key.revokedAt ? ` ${when(key.revokedAt)}` : ''}</td>
                        <td>{when(key.expiresAt)}</td>
                        <td>{when(key.lastUsedAt)}</td>
                        <td>{key.rateLimit.enabled ? `${key.rateLimit.requests} / ${key.rateLimit.windowSeconds}s` : 'off'}</td>
                        <td>
                            {#if key.status === 'active'}
                                {#if data.capabilities?.rotate}
                                    <form method="POST" action="?/rotate">
                                        <input type="hidden" name="keyId" value={key.id} />
                                        <button type="submit">Rotate</button>
                                    </form>
                                {/if}
                                {#if data.capabilities?.revoke}
                                    <form method="POST" action="?/revoke">
                                        <input type="hidden" name="keyId" value={key.id} />
                                        <button type="submit">Revoke</button>
                                    </form>
                                {/if}
                            {:else}
                                —
                            {/if}
                        </td>
                    </tr>
                {/each}
            </tbody>
        </table>
        <nav aria-label="Key pages">
            {#if previous !== null}<a href={`?offset=${previous}`}>Previous</a>{/if}
            <span>{data.offset + 1}–{data.offset + data.page.keys.length} of {data.page.total}</span>
            {#if next !== null}<a href={`?offset=${next}`}>Next</a>{/if}
        </nav>
    {/if}
{/if}
