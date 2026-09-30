<script lang="ts">
import { PAGE_SIZE } from '$lib/access-shared.js';
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();
const back = $derived(
    new URLSearchParams({ ...(data.email ? { email: data.email } : {}), offset: String(data.offset) }).toString(),
);
const next = $derived(data.page && data.offset + PAGE_SIZE < data.page.total ? data.offset + PAGE_SIZE : null);
const previous = $derived(data.offset > 0 ? Math.max(0, data.offset - PAGE_SIZE) : null);
const href = (offset: number) =>
    `?${new URLSearchParams({ ...(data.email ? { email: data.email } : {}), offset: String(offset) })}`;
</script>

<svelte:head><title>User access</title></svelte:head>
<h1>User access</h1>
<p>Choose who can use administration. Staff can manage records; administrators are created with the command line and are not changed here.</p>
{#if form?.message}<p role="alert">{form.message}</p>{/if}
{#if data.saved}<p role="status">{data.saved === 'staff' ? 'User is now staff.' : 'Staff access removed.'}</p>{/if}
{#if data.message}
    <p role="alert">{data.message}</p>
{:else if data.page}
    <form method="GET" role="search">
        <label>Find by exact email <input name="email" type="email" value={data.email} maxlength="254" /></label>
        <button type="submit">Find</button>
    </form>
    {#if data.page.users.length === 0}
        <p>No users found.</p>
    {:else}
        <table>
            <thead><tr><th>Email</th><th>Name</th><th>User ID</th><th>Role</th><th>Two-factor</th><th>Access</th></tr></thead>
            <tbody>
                {#each data.page.users as user (user.id)}
                    <tr>
                        <td>{user.email}</td>
                        <td>{user.name}</td>
                        <td><code>{user.id}</code></td>
                        <td>{user.role}</td>
                        <td>{user.twoFactorEnabled ? 'On' : 'Off'}</td>
                        <td>
                            {#if user.role === 'admin'}
                                Administrator
                            {:else}
                                <form method="POST" action="?/role">
                                    <input type="hidden" name="userId" value={user.id} />
                                    <input type="hidden" name="back" value={`?${back}`} />
                                    {#if user.role === 'staff'}
                                        <button type="submit" name="role" value="user">Remove staff access</button>
                                    {:else}
                                        <button type="submit" name="role" value="staff">Make staff</button>
                                    {/if}
                                </form>
                            {/if}
                        </td>
                    </tr>
                {/each}
            </tbody>
        </table>
        <nav aria-label="User pages">
            {#if previous !== null}<a href={href(previous)}>Previous</a>{/if}
            <span>{data.offset + 1}–{data.offset + data.page.users.length} of {data.page.total}</span>
            {#if next !== null}<a href={href(next)}>Next</a>{/if}
        </nav>
    {/if}
{/if}
