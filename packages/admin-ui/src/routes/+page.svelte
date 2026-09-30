<script lang="ts">
import { resourceHref } from '$lib/routes.js';
import type { PageProps } from './$types';

let { data }: PageProps = $props();
</script>

<svelte:head><title>Administration</title></svelte:head>
<h1>Administration</h1>
{#if data.admin.status === 'ready'}
    {#if data.admin.resources.length === 0}
        <p>No resources are available for your account.</p>
    {:else}
        <p>Choose a resource to open its workspace.</p>
        <ul>
            {#each data.admin.resources as resource (resource.identity)}
                <li><a href={resourceHref(resource)}>{resource.label}</a></li>
            {/each}
        </ul>
    {/if}
{/if}
