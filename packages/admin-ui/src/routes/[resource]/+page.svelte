<script lang="ts">
import ResourceList from '$lib/ResourceList.svelte';
import { resourceHref } from '$lib/routes.js';
import type { PageProps } from './$types';

let { data }: PageProps = $props();
</script>
<svelte:head><title>{data.workspace?.resource.label ?? 'Resource'} — Administration</title></svelte:head>
{#if data.workspace}
    <a href={resourceHref(data.workspace.resource)}>{data.workspace.resource.label}</a>
    <h1>{data.workspace.resource.label}</h1>
    {#if data.saved && !data.message}<p role="status">{data.saved === 'delete' ? 'Record deleted.' : 'Changes saved.'}</p>{/if}
    {#if data.message}<p role="alert">{data.message}</p><a href={resourceHref(data.workspace.resource)}>Return to resource</a>
    {:else}
        {#if data.workspace.resource.capabilities.create}<a href={`${resourceHref(data.workspace.resource)}/new`}>New {data.workspace.resource.label}</a>{/if}
        <ResourceList resource={data.workspace.resource} rows={data.rows} limit={data.limit} orderBy={data.orderBy} />
    {/if}
{/if}
