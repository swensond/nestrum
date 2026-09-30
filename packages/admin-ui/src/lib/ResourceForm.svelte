<script lang="ts">
import type { AdminResourceMetadata } from '@nestrum/admin';
import type { AdminComponentRegistry } from './component-registry.js';
import type { AdminRecord } from './crud.js';
import FieldRenderer from './FieldRenderer.svelte';
import type { FormFeedback, FormMode } from './fields.js';

let {
    resource,
    mode,
    record = {},
    feedback = null,
    components,
}: {
    resource: AdminResourceMetadata;
    mode: FormMode;
    record?: AdminRecord;
    feedback?: FormFeedback | null;
    components?: AdminComponentRegistry | undefined;
} = $props();
let pending = $state(false);
</script>
<form method="POST" action={mode === 'create' ? '?/create' : '?/update'} onsubmit={() => { pending = true; }}>
    {#if feedback?.message}<p role="alert">{feedback.message}</p>{/if}
    {#if mode === 'update'}<p>Edit a value or choose “Set value” for each field you want to change. Other fields keep their existing values.</p>{/if}
    <fieldset>
        {#each resource.fields as field (field.name)}
            <FieldRenderer {components} {field} {mode} value={record[field.name]} submitted={feedback?.values[field.name]} selection={feedback?.modes[field.name]} errors={feedback?.fields[field.name] ?? []} />
        {/each}
        <button type="submit" disabled={pending}>{pending ? 'Saving…' : mode === 'create' ? 'Create' : 'Save changes'}</button>
    </fieldset>
</form>
<style>fieldset { border: 0; padding: 0; display: grid; gap: 1.25rem; max-width: 40rem; } button { justify-self: start; }</style>
