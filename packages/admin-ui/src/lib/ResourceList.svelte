<script lang="ts">
import type { AdminResourceMetadata } from '@nestrum/admin';
import type { AdminRecord } from './crud.js';
import ResourceTable from './ResourceTable.svelte';

let {
    resource,
    rows,
    limit = 20,
    orderBy = '',
}: { resource: AdminResourceMetadata; rows: AdminRecord[]; limit?: number; orderBy?: string } = $props();
</script>
{#if resource.capabilities.list}
<form method="GET">
    <label>Maximum records <select name="limit" value={String(limit)}>{#each [20, 50, 100] as size}<option value={String(size)}>{size}</option>{/each}</select></label>
    <label>Order by <select name="orderBy" value={orderBy}><option value="">Default order</option>{#each resource.fields.filter((field) => !field.array) as field}<option value={field.name}>{field.label} ascending</option><option value={`-${field.name}`}>{field.label} descending</option>{/each}</select></label>
    <button type="submit">Apply</button>
</form>
<ResourceTable {resource} {rows} />
<p>Showing up to {limit} records.</p>
{:else}<p>You do not have permission to list records.</p>{/if}
