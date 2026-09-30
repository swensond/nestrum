<script lang="ts">
import AdminShell from '../src/lib/AdminShell.svelte';
import type { AdminShellState } from '../src/lib/metadata.js';

let {
    state,
    loading = false,
    activePath = '/admin',
}: { state: AdminShellState; loading?: boolean; activePath?: string } = $props();
</script>
<AdminShell {state} {loading} {activePath}><p>Protected workspace content</p></AdminShell>
