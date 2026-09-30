<script lang="ts">
import type { AdminWorkspace } from './routes.js';
import { resourceHref } from './routes.js';

let { workspace }: { workspace: AdminWorkspace } = $props();
</script>

<svelte:head><title>{workspace.view === 'new' ? 'New ' : ''}{workspace.resource.label} — Administration</title></svelte:head>
<a href={resourceHref(workspace.resource)}>{workspace.resource.label}</a>
<h1>{workspace.view === 'new' ? 'New ' : ''}{workspace.resource.label}</h1>
{#if workspace.view === 'detail'}<p>Record <code>{workspace.id}</code></p>{/if}
{#if workspace.view === 'list' && workspace.resource.capabilities.create}
    <a href={`${resourceHref(workspace.resource)}/new`}>New {workspace.resource.label}</a>
{/if}
<h2>Fields</h2>
<ul>
    {#each workspace.resource.fields as field (field.name)}
        <li>{field.label}{field.readOnly ? ' (read only)' : ''}</li>
    {/each}
</ul>
