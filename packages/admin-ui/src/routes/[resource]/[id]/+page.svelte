<script lang="ts">
import { displayValue } from '$lib/fields.js';
import ResourceDelete from '$lib/ResourceDelete.svelte';
import ResourceEdit from '$lib/ResourceEdit.svelte';
import { resourceHref } from '$lib/routes.js';
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();
</script>
<svelte:head><title>{data.workspace?.resource.label ?? 'Resource'} — Administration</title></svelte:head>
{#if data.workspace}
    <a href={resourceHref(data.workspace.resource)}>{data.workspace.resource.label}</a>
    <h1>{data.workspace.resource.label}</h1>
    {#if data.saved && !data.message}<p role="status">{data.saved === 'delete' ? 'Record deleted.' : 'Changes saved.'}</p>{/if}
    {#if data.message}<p role="alert">{data.message}</p><a href={resourceHref(data.workspace.resource)}>Return to resource</a>
    {:else}
        <p>Record <code>{data.workspace.id}</code></p>
        {#if data.workspace.resource.capabilities.update}
            <ResourceEdit resource={data.workspace.resource} record={data.record ?? {}} feedback={form} />
        {:else if data.record}
            <dl>{#each data.workspace.resource.fields as field}<dt>{field.label}</dt><dd>{displayValue(data.record[field.name])}</dd>{/each}</dl>
        {/if}
        {#if data.workspace.resource.capabilities.delete}<ResourceDelete label={data.workspace.resource.label} id={data.workspace.id ?? ''} feedback={form} />{/if}
    {/if}
{/if}
