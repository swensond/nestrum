<script lang="ts">
import AdminShell from '../src/lib/AdminShell.svelte';
import type { AdminShellState } from '../src/lib/metadata.js';

let {
    state,
    loading = false,
    activePath = '/admin',
    canManageUsers = false,
    canManageApiKeys = false,
}: {
    state: AdminShellState;
    loading?: boolean;
    activePath?: string;
    canManageUsers?: boolean;
    canManageApiKeys?: boolean;
} = $props();
</script>
<AdminShell {state} {loading} {activePath} {canManageUsers} {canManageApiKeys}><p>Protected workspace content</p></AdminShell>
