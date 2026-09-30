<script lang="ts">
import { invalidateAll } from '$app/navigation';
import { navigating } from '$app/state';
import AdminShell from '$lib/AdminShell.svelte';
import type { LayoutProps } from './$types';

let { data, children }: LayoutProps = $props();
</script>

<AdminShell state={data.admin} activePath={data.path} loading={navigating.to !== null} onretry={() => invalidateAll()}>
    {@render children()}
</AdminShell>
