<script lang="ts">
import type { AdminFieldMetadata } from '@nestrum/admin';
import type { FormMode, ValueMode } from './fields.js';
import { displayValue, fieldWidget, initialValueMode, inputValue } from './fields.js';

let {
    field,
    mode,
    value,
    submitted,
    selection,
    errors = [],
}: {
    field: AdminFieldMetadata;
    mode: FormMode;
    value?: unknown;
    submitted?: string | undefined;
    selection?: ValueMode | undefined;
    errors?: string[];
} = $props();
let chosen = $derived(selection ?? initialValueMode(field, mode, value));
const widget = $derived(fieldWidget(field, mode));
const text = $derived(submitted ?? inputValue(field, value));
const id = $derived(`field-${field.name}`);
const required = $derived(mode === 'create' && field.required && !field.nullable);
</script>

<div class="field">
    {#if widget === 'readonly'}
        <span>{field.label} (read only)</span><output>{displayValue(value)}</output>
    {:else}
        <label for={id}>{field.label}{['date', 'datetime-string', 'temporal-instant'].includes(field.kind) && !field.array ? ' (UTC)' : ''}</label>
        {#if mode === 'update' || !field.required || field.nullable}
            <label class="mode">Value handling
                <select name={`mode:${field.name}`} bind:value={chosen}>
                    <option value="value">Set value</option>
                    {#if mode === 'update' || !field.required}<option value="omit">{mode === 'update' ? 'Keep existing value' : 'Use default / leave unset'}</option>{/if}
                    {#if field.nullable}<option value="null">Set to null</option>{/if}
                </select>
            </label>
        {:else}<input type="hidden" name={`mode:${field.name}`} value="value" />{/if}
        {#if widget === 'textarea'}
            <textarea oninput={() => { chosen = 'value'; }} {id} name={field.name} value={text} {required} aria-invalid={errors.length > 0} aria-describedby={errors.length ? `${id}-errors` : undefined} rows="4"></textarea>
            {#if field.array}<small>Enter a JSON array.</small>{/if}
        {:else if widget === 'enum' || widget === 'boolean'}
            <select onchange={() => { chosen = 'value'; }} {id} name={field.name} value={text} {required} aria-invalid={errors.length > 0} aria-describedby={errors.length ? `${id}-errors` : undefined}>
                <option value="">Choose a value</option>
                {#each widget === 'boolean' ? ['true', 'false'] : field.enumValues as option}<option value={option}>{option}</option>{/each}
            </select>
        {:else}
            <input oninput={() => { chosen = 'value'; }} {id} name={field.name} type={widget === 'text' ? 'text' : widget} value={text} {required} step={widget === 'number' && field.kind === 'integer' ? '1' : 'any'} aria-invalid={errors.length > 0} aria-describedby={errors.length ? `${id}-errors` : undefined} />
        {/if}
    {/if}
    {#if errors.length}<ul id={`${id}-errors`} class="errors">{#each errors as message}<li>{message}</li>{/each}</ul>{/if}
</div>
<style>
    .field { display: grid; gap: .5rem; } .mode { font-size: .9rem; display: flex; gap: .5rem; align-items: center; }
    input, select, textarea { font: inherit; padding: .5rem; max-width: 100%; } .errors { color: #9d2020; }
</style>
