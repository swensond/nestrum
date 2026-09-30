<script lang="ts">
import type { AdminResourceMetadata } from '@nestrum/admin';
import type { AdminRecord } from './crud.js';
import { recordHref } from './crud.js';
import { displayValue } from './fields.js';

let { resource, rows }: { resource: AdminResourceMetadata; rows: AdminRecord[] } = $props();
const columns = $derived(
    resource.listDisplay
        .map((name) => resource.fields.find((field) => field.name === name))
        .filter((field) => field !== undefined),
);
const canOpen = $derived(
    resource.capabilities.retrieve || resource.capabilities.update || resource.capabilities.delete,
);
</script>
{#if rows.length === 0}<p>No records found.</p>{:else}
<div class="table"><table>
    <caption>{resource.label} records</caption>
    <thead><tr>{#each columns as field}<th scope="col">{field.label}</th>{/each}{#if canOpen}<th scope="col">Record</th>{/if}</tr></thead>
    <tbody>{#each rows as row}<tr>{#each columns as field}<td>{displayValue(row[field.name])}</td>{/each}
        {#if canOpen}{@const href = recordHref(resource, row)}<td>{#if href}<a {href}>Open record</a>{:else}Unavailable{/if}</td>{/if}
    </tr>{/each}</tbody>
</table></div>
{/if}
<style>.table { overflow-x: auto; } table { border-collapse: collapse; width: 100%; } td, th { text-align: left; padding: .7rem; border-bottom: 1px solid #d9e1eb; } caption { text-align: left; margin-bottom: .5rem; }</style>
