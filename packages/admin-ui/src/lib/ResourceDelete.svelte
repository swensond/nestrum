<script lang="ts">
import type { FormFeedback } from './fields.js';

let { label, id, feedback = null }: { label: string; id: string; feedback?: FormFeedback | null } = $props();
let pending = $state(false);
</script>
<section aria-label="Delete record">
    <h2>Delete {label}</h2>
    <p>Deleting record {id} cannot be undone.</p>
    <form method="POST" action="?/delete" onsubmit={() => { pending = true; }}>
        {#if feedback?.message}<p role="alert">{feedback.message}</p>{/if}
        <label><input name="confirm" type="checkbox" value="yes" required /> Confirm permanent deletion</label>
        <button type="submit" disabled={pending}>{pending ? 'Deleting…' : 'Delete'}</button>
    </form>
</section>
