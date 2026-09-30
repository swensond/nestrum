<script lang="ts">
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();
const when = (value: string) => value.replace('T', ' ').slice(0, 16);
const describe = (rule: { scope: string; target: string; enabled: boolean; percentage: number | null }) =>
    rule.scope === 'percentage'
        ? `${rule.percentage}% rollout`
        : `${rule.scope}${rule.target ? ` ${rule.target}` : ''}: ${rule.enabled ? 'on' : 'off'}`;
</script>

<svelte:head><title>Feature flags</title></svelte:head>
<h1>Feature flags</h1>
<p>Flags say whether a capability is switched on. They never grant access: every action still needs permission. Precedence, first match wins: subject, organization, percentage rollout, environment, global, then the default declared in source.</p>
{#if form?.message}<p role="alert">{form.message}</p>{/if}
{#if form && 'saved' in form && form.saved}<p role="status">Saved an override for {form.saved}.</p>{/if}
{#if form && 'removed' in form && form.removed}<p role="status">Removed an override for {form.removed}.</p>{/if}
{#if data.message}
    <p role="alert">{data.message}</p>
{:else if data.flags}
    {#if data.flags.length === 0}
        <p>No feature flags are declared.</p>
    {/if}
    {#each data.flags as flag (flag.name)}
        <section aria-labelledby={`flag-${flag.name}`}>
            <h2 id={`flag-${flag.name}`}><code>{flag.name}</code></h2>
            {#if flag.description}<p>{flag.description}</p>{/if}
            <p>Default: {flag.default ? 'on' : 'off'}. {flag.exposeToClient ? 'Evaluated value is sent to the consumer UI.' : 'Server only.'}</p>
            {#if flag.rules.length === 0}
                <p>No overrides.</p>
            {:else}
                <ul>
                    {#each flag.rules as rule (rule.id)}
                        <li>
                            {describe(rule)} <small>updated {when(rule.updatedAt)}{rule.updatedBy ? ` by ${rule.updatedBy}` : ''}</small>
                            {#if data.capabilities?.manage}
                                <form method="POST" action="?/remove">
                                    <input type="hidden" name="flag" value={flag.name} />
                                    <input type="hidden" name="scope" value={rule.scope} />
                                    <input type="hidden" name="target" value={rule.target} />
                                    <button type="submit">Remove</button>
                                </form>
                            {/if}
                        </li>
                    {/each}
                </ul>
            {/if}
            {#if data.capabilities?.manage}
                <form method="POST" action="?/save">
                    <input type="hidden" name="flag" value={flag.name} />
                    <label>Applies to
                        <select name="scope">
                            <option value="global">Everyone (global)</option>
                            <option value="environment">Environment</option>
                            <option value="organization">Organization</option>
                            <option value="subject">Subject</option>
                            <option value="percentage">Percentage rollout</option>
                        </select>
                    </label>
                    <label>Target (environment name, organization ID or subject ID) <input name="target" maxlength="256" autocomplete="off" /></label>
                    <label>State
                        <select name="enabled"><option value="true">On</option><option value="false">Off</option></select>
                    </label>
                    <label>Rollout percentage (percentage scope only) <input name="percentage" inputmode="decimal" pattern="[0-9]{'{1,3}'}([.][0-9]{'{1,2}'})?" /></label>
                    <button type="submit">Save override</button>
                </form>
            {/if}
            <form method="POST" action="?/explain">
                <input type="hidden" name="flag" value={flag.name} />
                <label>Subject ID <input name="subjectId" maxlength="256" autocomplete="off" /></label>
                <label>Organization ID <input name="organizationId" maxlength="256" autocomplete="off" /></label>
                <label>Environment <input name="environment" maxlength="64" autocomplete="off" /></label>
                <button type="submit">Explain</button>
            </form>
            {#if form && 'explanation' in form && form.explanation && form.explanation.flag === flag.name}
                <p role="status" data-testid="explanation">
                    {form.explanation.enabled ? 'On' : 'Off'} because of {form.explanation.reason.source}{form.explanation.reason.target ? ` ${form.explanation.reason.target}` : ''}{form.explanation.reason.percentage !== undefined ? ` (${form.explanation.reason.percentage}%)` : ''}.
                </p>
            {/if}
        </section>
    {/each}
{/if}
