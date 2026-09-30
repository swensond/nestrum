<script lang="ts">
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();
const when = (value: string | null) => (value ? value.replace('T', ' ').slice(0, 16) : '—');
const verification = (value: string) => (value === 'not-required' ? 'not required' : value);
</script>

<svelte:head><title>Single sign-on</title></svelte:head>
<h1>Single sign-on</h1>
<p>Connect your organization’s identity providers with OpenID Connect or SAML 2.0. Signing in through a provider does not satisfy the administration second factor, and identity provider attributes never grant permissions.</p>
{#if form?.message}<p role="alert">{form.message}</p>{/if}
{#if form && 'toggled' in form && form.toggled}<p role="status">Provider {form.toggled}.</p>{/if}
{#if form && 'test' in form && form.test}
    <section aria-labelledby="test-title">
        <h2 id="test-title">Validation result for <code>{form.test.providerId}</code></h2>
        <p role="status">{form.test.valid ? 'The configuration is valid.' : 'The configuration has problems.'} This checks configuration only; it is not a sign-in.</p>
        {#if form.test.diagnostics.length}
            <ul>{#each form.test.diagnostics as diagnostic (diagnostic.code)}<li>{diagnostic.severity}: {diagnostic.message}</li>{/each}</ul>
        {/if}
    </section>
{/if}
{#if data.message}
    <p role="alert">{data.message}</p>
{:else if data.providers}
    {#if data.capabilities?.create}
        <p><a href="/admin/auth/sso/new">Add a provider</a></p>
    {/if}
    {#if data.providers.length === 0}
        <p>No SSO providers are configured.</p>
    {:else}
        <table>
            <thead>
                <tr><th>Name</th><th>Provider ID</th><th>Protocol</th><th>Organization</th><th>Domains</th><th>Status</th><th>Domain verification</th><th>Last validation</th><th>Last sign-in</th><th>Actions</th></tr>
            </thead>
            <tbody>
                {#each data.providers as provider (provider.providerId)}
                    <tr>
                        <td>{provider.displayName}</td>
                        <td><code>{provider.providerId}</code></td>
                        <td>{provider.type === 'oidc' ? 'OIDC' : 'SAML 2.0'}</td>
                        <td>{provider.organizationId ?? '—'}</td>
                        <td>{provider.domains.join(', ')}</td>
                        <td>{provider.enabled ? 'Enabled' : 'Disabled'}</td>
                        <td>{verification(provider.domainVerification)}</td>
                        <td>{when(provider.lastValidatedAt)}{provider.lastValidationStatus ? ` (${provider.lastValidationStatus})` : ''}</td>
                        <td>{when(provider.lastSuccessfulLoginAt)}</td>
                        <td>
                            {#if data.capabilities?.update}<a href={`/admin/auth/sso/${provider.providerId}`}>Edit</a>{/if}
                            {#if data.capabilities?.test}
                                <form method="POST" action="?/test"><input type="hidden" name="providerId" value={provider.providerId} /><button type="submit">Test</button></form>
                            {/if}
                            {#if provider.enabled && data.capabilities?.disable}
                                <form method="POST" action="?/disable"><input type="hidden" name="providerId" value={provider.providerId} /><button type="submit">Disable</button></form>
                            {:else if !provider.enabled && data.capabilities?.enable}
                                <form method="POST" action="?/enable"><input type="hidden" name="providerId" value={provider.providerId} /><button type="submit">Enable</button></form>
                            {/if}
                            {#if data.capabilities?.delete}<a href={`/admin/auth/sso/${provider.providerId}#delete`}>Delete</a>{/if}
                        </td>
                    </tr>
                {/each}
            </tbody>
        </table>
    {/if}
{/if}
