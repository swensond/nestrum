<script lang="ts">
import type { AdminResourceMetadata } from '@nestrum/admin';
import type { AdminRecord } from './crud.js';
import type { FormFeedback } from './fields.js';
import ResourceForm from './ResourceForm.svelte';

let {
    resource,
    record = {},
    feedback = null,
}: { resource: AdminResourceMetadata; record?: AdminRecord; feedback?: FormFeedback | null } = $props();
</script>
<ResourceForm {resource} {record} {feedback} mode="create" />
