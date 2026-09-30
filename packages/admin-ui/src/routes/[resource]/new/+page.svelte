<script lang="ts">
import ResourceCreate from '$lib/ResourceCreate.svelte';
import { resourceHref } from '$lib/routes.js';
import type { PageProps } from './$types';

let { data, form }: PageProps = $props();
</script>
<svelte:head><title>{data.workspace?.resource.label ?? 'Resource'} — Administration</title></svelte:head>
{#if data.workspace}
    <a href={resourceHref(data.workspace.resource)}>{data.workspace.resource.label}</a>
    <h1>New {data.workspace.resource.label}</h1>
    {#if data.saved && !data.message}<p role="status">{data.saved === 'delete' ? 'Record deleted.' : 'Changes saved.'}</p>{/if}
    {#if data.message}<p role="alert">{data.message}</p><a href={resourceHref(data.workspace.resource)}>Return to resource</a>
    {:else}
        <ResourceCreate resource={data.workspace.resource} feedback={form} />
    {/if}
{/if}
