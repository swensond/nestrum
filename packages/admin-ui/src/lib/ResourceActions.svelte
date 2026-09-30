<script lang="ts">
import type { AdminResourceMetadata } from '@nestrum/admin';
import type { FormFeedback } from './fields.js';

let { resource, feedback = null }: { resource: AdminResourceMetadata; feedback?: FormFeedback | null } = $props();
let pending = $state(false);
</script>
{#if resource.actions.length}
<section aria-label="Record actions">
    <h2>Actions</h2>
    {#each resource.actions as action (action.name)}
        <form method="POST" action="?/action" onsubmit={() => { pending = true; }}>
            <input type="hidden" name="action" value={action.name} />
            {#if feedback?.values.action === action.name && feedback.message}<p role="alert">{feedback.message}</p>{/if}
            <label>{action.label} input (JSON)
                <textarea name="input" rows="2" value={feedback?.values.action === action.name ? feedback.values.input ?? '{}' : '{}'}></textarea>
            </label>
            <button type="submit" disabled={pending}>{pending ? 'Running…' : action.label}</button>
        </form>
    {/each}
</section>
{/if}
<style>form { display: grid; gap: .5rem; margin-bottom: 1rem; max-width: 40rem; } label { display: grid; gap: .5rem; } button { justify-self: start; }</style>
