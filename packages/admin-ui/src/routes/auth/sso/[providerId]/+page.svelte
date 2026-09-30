<script lang="ts">
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();
const when = (value: string | null) => (value ? value.replace('T', ' ').slice(0, 16) : '—');
const provider = $derived(data.provider);
</script>

<svelte:head><title>SSO provider</title></svelte:head>
<h1>{provider ? provider.displayName : 'SSO provider'}</h1>
<p><a href="/admin/auth/sso">Back to providers</a></p>
{#if form?.message}<p role="alert">{form.message}</p>{/if}
{#if form && 'saved' in form && form.saved}<p role="status">Saved.</p>{/if}
{#if form && 'toggled' in form && form.toggled}<p role="status">Provider {form.toggled}.</p>{/if}
{#if form && 'verified' in form && form.verified}<p role="status">Domains verified.</p>{/if}
{#if form && 'test' in form && form.test}
    <section aria-labelledby="test-title">
        <h2 id="test-title">Validation result</h2>
        <p role="status">{form.test.valid ? 'The configuration is valid.' : 'The configuration has problems.'} This checks configuration only; it is not a sign-in.</p>
        {#if form.test.diagnostics.length}
            <ul>{#each form.test.diagnostics as diagnostic (diagnostic.code)}<li>{diagnostic.severity}: {diagnostic.message}</li>{/each}</ul>
        {/if}
    </section>
{/if}
{#if data.message}
    <p role="alert">{data.message}</p>
{:else if provider}
    <dl>
        <dt>Provider ID</dt><dd><code>{provider.providerId}</code></dd>
        <dt>Protocol</dt><dd>{provider.type === 'oidc' ? 'OpenID Connect' : 'SAML 2.0'}</dd>
        <dt>Status</dt><dd>{provider.enabled ? 'Enabled' : 'Disabled'}</dd>
        <dt>Last validation</dt><dd>{when(provider.lastValidatedAt)}{provider.lastValidationStatus ? ` (${provider.lastValidationStatus})` : ''}</dd>
        <dt>Last successful sign-in</dt><dd>{when(provider.lastSuccessfulLoginAt)}</dd>
    </dl>
    {#if provider.type === 'oidc'}
        <h2>Redirect URI</h2>
        <p>Register this redirect (callback) URI with your identity provider:</p>
        <p><code data-testid="sso-redirect-uri">{provider.redirectUri}</code></p>
    {:else}
        <h2>Service provider values</h2>
        <p>Enter these in your identity provider:</p>
        <dl>
            <dt>ACS URL</dt><dd><code data-testid="sso-acs-url">{provider.serviceProvider.acsUrl}</code></dd>
            <dt>SP entity ID</dt><dd><code data-testid="sso-entity-id">{provider.serviceProvider.entityId}</code></dd>
            <dt>SP metadata URL</dt><dd><code>{provider.serviceProvider.metadataUrl}</code></dd>
            <dt>Callback</dt><dd><code>{provider.serviceProvider.callbackUrl}</code></dd>
            {#if provider.idpEntityId}<dt>IdP entity ID</dt><dd><code>{provider.idpEntityId}</code></dd>{/if}
        </dl>
    {/if}
    {#if data.capabilities?.update}
        <h2>Settings</h2>
        <form method="POST" action="?/update">
            <input type="hidden" name="type" value={provider.type} />
            <input type="hidden" name="providerId" value={provider.providerId} />
            <label>Display name <input name="displayName" required maxlength="100" value={provider.displayName} /></label>
            <label>Organization ID <input name="organizationId" maxlength="128" value={provider.organizationId ?? ''} autocomplete="off" /></label>
            <label>Email domains <input name="domains" required value={provider.domains.join(' ')} autocomplete="off" /></label>
            {#if provider.type === 'oidc'}
                <label>Issuer URL <input name="issuer" type="url" required value={provider.issuer} autocomplete="off" /></label>
                <label>Client ID <input name="clientId" required maxlength="512" value={provider.clientId} autocomplete="off" /></label>
                <label>Client secret <input name="clientSecret" type="password" autocomplete="new-password" placeholder={provider.clientSecretConfigured ? 'Configured — leave blank to keep' : 'Not configured'} /></label>
                <details>
                    <summary>Advanced</summary>
                    <label>Scopes <input name="scopes" value={(provider.advanced.scopes ?? []).join(' ')} autocomplete="off" /></label>
                    <label><input type="checkbox" name="pkce" checked={provider.advanced.pkce !== false} /> Use PKCE</label>
                    <label>Authorization endpoint <input name="authorizationEndpoint" type="url" value={provider.advanced.authorizationEndpoint ?? ''} autocomplete="off" /></label>
                    <label>Token endpoint <input name="tokenEndpoint" type="url" value={provider.advanced.tokenEndpoint ?? ''} autocomplete="off" /></label>
                    <label>JWKS endpoint <input name="jwksEndpoint" type="url" value={provider.advanced.jwksEndpoint ?? ''} autocomplete="off" /></label>
                    <label>User info endpoint <input name="userInfoEndpoint" type="url" value={provider.advanced.userInfoEndpoint ?? ''} autocomplete="off" /></label>
                    <label>Token endpoint authentication
                        <select name="tokenEndpointAuthentication">
                            <option value="" selected={!provider.advanced.tokenEndpointAuthentication}>Default</option>
                            <option value="client_secret_basic" selected={provider.advanced.tokenEndpointAuthentication === 'client_secret_basic'}>client_secret_basic</option>
                            <option value="client_secret_post" selected={provider.advanced.tokenEndpointAuthentication === 'client_secret_post'}>client_secret_post</option>
                        </select>
                    </label>
                </details>
            {:else}
                <label>Replace IdP metadata XML <textarea name="idpMetadata" rows="6" maxlength="102400" placeholder={provider.idpMetadataConfigured ? 'Configured — paste new XML to replace' : 'Paste the metadata XML'}></textarea></label>
                <details>
                    <summary>Advanced</summary>
                    <label>IdP single sign-on URL <input name="entryPoint" type="url" value={provider.advanced.entryPoint ?? ''} autocomplete="off" /></label>
                    <label><input type="checkbox" name="wantAssertionsSigned" checked={provider.advanced.wantAssertionsSigned !== false} /> Require signed assertions</label>
                    <label>NameID format <input name="identifierFormat" value={provider.advanced.identifierFormat ?? ''} autocomplete="off" /></label>
                    <label>Audience <input name="audience" value={provider.advanced.audience ?? ''} autocomplete="off" /></label>
                    <label>IdP-initiated destination <input name="idpInitiatedCallbackUrl" value={provider.advanced.idpInitiatedCallbackUrl ?? ''} autocomplete="off" /></label>
                </details>
            {/if}
            <button type="submit">Save changes</button>
        </form>
    {/if}
    <h2>Actions</h2>
    {#if data.capabilities?.test}
        <form method="POST" action="?/test"><input type="hidden" name="providerId" value={provider.providerId} /><button type="submit">Test configuration</button></form>
    {/if}
    {#if provider.enabled && data.capabilities?.disable}
        <form method="POST" action="?/disable"><input type="hidden" name="providerId" value={provider.providerId} /><button type="submit">Disable</button></form>
    {:else if !provider.enabled && data.capabilities?.enable}
        <form method="POST" action="?/enable"><input type="hidden" name="providerId" value={provider.providerId} /><button type="submit">Enable</button></form>
    {/if}
    <h2>Domain verification</h2>
    <p>Status: {provider.domainVerification === 'not-required' ? 'not required by this application' : provider.domainVerification}. Domains: {provider.domains.join(', ')}.</p>
    {#if provider.domainVerification !== 'not-required' && provider.domainVerification !== 'verified' && data.capabilities?.update}
        {#if form && 'verification' in form && form.verification?.recordName}
            <p>For each domain, add a DNS TXT record named <code>{form.verification.recordName}.&lt;domain&gt;</code> with the value <code data-testid="sso-dns-value">{form.verification.recordValue}</code>, then verify.</p>
        {/if}
        <form method="POST" action="?/requestVerification"><input type="hidden" name="providerId" value={provider.providerId} /><button type="submit">Show DNS record</button></form>
        <form method="POST" action="?/verify"><input type="hidden" name="providerId" value={provider.providerId} /><button type="submit">Verify domains</button></form>
    {/if}
    {#if data.capabilities?.delete}
        <h2 id="delete">Delete provider</h2>
        <p>Deleting removes this provider’s configuration and blocks its sign-ins. It does not delete users, their linked accounts or their sessions.</p>
        <form method="POST" action="?/delete">
            <input type="hidden" name="providerId" value={provider.providerId} />
            <label>Type <code>{provider.providerId}</code> to confirm <input name="confirm" required autocomplete="off" /></label>
            <button type="submit">Delete provider</button>
        </form>
    {/if}
{/if}
