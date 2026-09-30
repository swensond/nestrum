<script lang="ts">
import AdminShell from '../src/lib/AdminShell.svelte';
import type { AdminShellState } from '../src/lib/metadata.js';

let {
    state,
    loading = false,
    activePath = '/admin',
    canManageUsers = false,
    canManageApiKeys = false,
    canViewFeatures = false,
    canManageSso = false,
}: {
    state: AdminShellState;
    loading?: boolean;
    activePath?: string;
    canManageUsers?: boolean;
    canManageApiKeys?: boolean;
    canViewFeatures?: boolean;
    canManageSso?: boolean;
} = $props();
</script>
<AdminShell {state} {loading} {activePath} {canManageUsers} {canManageApiKeys} {canViewFeatures} {canManageSso}><p>Protected workspace content</p></AdminShell>
