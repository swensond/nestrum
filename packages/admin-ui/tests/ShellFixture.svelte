<script lang="ts">
import AdminShell from '../src/lib/AdminShell.svelte';
import type { AdminShellState } from '../src/lib/metadata.js';

let {
    state,
    loading = false,
    activePath = '/admin',
    canManageUsers = false,
}: { state: AdminShellState; loading?: boolean; activePath?: string; canManageUsers?: boolean } = $props();
</script>
<AdminShell {state} {loading} {activePath} {canManageUsers}><p>Protected workspace content</p></AdminShell>
