<script lang="ts">
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();
</script>

<svelte:head><title>Add SSO provider</title></svelte:head>
<h1>Add an SSO provider</h1>
<p><a href="/admin/auth/sso">Back to providers</a></p>
{#if form?.message}<p role="alert">{form.message}</p>{/if}
{#if data.message}
    <p role="alert">{data.message}</p>
{:else}
    <nav aria-label="Protocol">
        <a href="?type=oidc" aria-current={data.type === 'oidc' ? 'page' : undefined}>OpenID Connect</a>
        <a href="?type=saml" aria-current={data.type === 'saml' ? 'page' : undefined}>SAML 2.0</a>
    </nav>
    <form method="POST" action="?/create">
        <input type="hidden" name="type" value={data.type} />
        <label>Display name <input name="displayName" required maxlength="100" /></label>
        <label>Provider ID <input name="providerId" required minlength="3" maxlength="48" pattern="[a-z][a-z0-9\-]*[a-z0-9]" autocomplete="off" /></label>
        <p>Lowercase letters, digits and hyphens. The provider ID is permanent and forms the sign-in callback address.</p>
        <label>Organization ID (optional) <input name="organizationId" maxlength="128" autocomplete="off" /></label>
        <label>Email domains (space or comma separated) <input name="domains" required placeholder="acme.com" autocomplete="off" /></label>
        {#if data.type === 'oidc'}
            <label>Issuer URL <input name="issuer" type="url" required placeholder="https://idp.example.com" autocomplete="off" /></label>
            <label>Client ID <input name="clientId" required maxlength="512" autocomplete="off" /></label>
            <label>Client secret <input name="clientSecret" type="password" required autocomplete="new-password" /></label>
            <details>
                <summary>Advanced</summary>
                <label>Scopes <input name="scopes" placeholder="openid email profile" autocomplete="off" /></label>
                <label><input type="checkbox" name="pkce" checked /> Use PKCE</label>
                <label>Discovery endpoint <input name="discoveryEndpoint" type="url" autocomplete="off" /></label>
                <label>Authorization endpoint <input name="authorizationEndpoint" type="url" autocomplete="off" /></label>
                <label>Token endpoint <input name="tokenEndpoint" type="url" autocomplete="off" /></label>
                <label>JWKS endpoint <input name="jwksEndpoint" type="url" autocomplete="off" /></label>
                <label>User info endpoint <input name="userInfoEndpoint" type="url" autocomplete="off" /></label>
                <label>Token endpoint authentication
                    <select name="tokenEndpointAuthentication"><option value="">Default (client_secret_basic)</option><option value="client_secret_basic">client_secret_basic</option><option value="client_secret_post">client_secret_post</option></select>
                </label>
                <label>Profile claim for email <input name="mapEmail" placeholder="email" autocomplete="off" /></label>
                <label>Profile claim for name <input name="mapName" placeholder="name" autocomplete="off" /></label>
                <label>Profile claim for user ID <input name="mapId" placeholder="sub" autocomplete="off" /></label>
            </details>
        {:else}
            <label>IdP metadata XML <textarea name="idpMetadata" rows="8" maxlength="102400" placeholder="Paste the metadata XML from your identity provider"></textarea></label>
            <p>After saving, this page shows the service provider values (ACS URL and entity ID) to enter in your identity provider.</p>
            <details>
                <summary>Advanced</summary>
                <p>Use these only when you have no metadata XML.</p>
                <label>IdP single sign-on URL <input name="entryPoint" type="url" autocomplete="off" /></label>
                <label>IdP signing certificate <textarea name="cert" rows="4" maxlength="20000"></textarea></label>
                <label><input type="checkbox" name="wantAssertionsSigned" checked /> Require signed assertions</label>
                <label>NameID format <input name="identifierFormat" autocomplete="off" /></label>
                <label>Audience <input name="audience" autocomplete="off" /></label>
                <label>IdP-initiated destination (relative path or trusted URL) <input name="idpInitiatedCallbackUrl" autocomplete="off" /></label>
                <label>Attribute for email <input name="mapEmail" placeholder="email" autocomplete="off" /></label>
                <label>Attribute for name <input name="mapName" placeholder="name" autocomplete="off" /></label>
                <label>Attribute for user ID <input name="mapId" placeholder="nameID" autocomplete="off" /></label>
            </details>
        {/if}
        <label><input type="checkbox" name="enabled" checked /> Enable immediately (the configuration is validated first)</label>
        <button type="submit">Add provider</button>
    </form>
{/if}
