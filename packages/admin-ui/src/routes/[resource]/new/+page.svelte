<script lang="ts">
import ResourceWorkspace from '$lib/ResourceWorkspace.svelte';
import type { PageProps } from './$types';

let { data }: PageProps = $props();
</script>
{#if data.workspace}<ResourceWorkspace workspace={data.workspace} />{/if}
