<script lang="ts">
import type { AdminWidgetProps } from '../src/lib/component-registry.js';

let { id, name, value, required, errors, onchange }: AdminWidgetProps = $props();
</script>
<textarea {id} {name} {required} {value} aria-invalid={errors.length > 0} oninput={(event) => onchange(event.currentTarget.value)} data-custom-widget="json-editor"></textarea>
