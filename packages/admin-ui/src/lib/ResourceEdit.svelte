<script lang="ts">
import type { AdminResourceMetadata } from '@nestrum/admin';
import type { AdminComponentRegistry } from './component-registry.js';
import type { AdminRecord } from './crud.js';
import type { FormFeedback } from './fields.js';
import ResourceForm from './ResourceForm.svelte';

let {
    resource,
    record = {},
    feedback = null,
    components,
}: {
    resource: AdminResourceMetadata;
    record?: AdminRecord;
    feedback?: FormFeedback | null;
    components?: AdminComponentRegistry | undefined;
} = $props();
</script>
<ResourceForm {components} {resource} {record} {feedback} mode="update" />
