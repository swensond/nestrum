<script lang="ts">
import { setContext } from 'svelte';
import adminComponents from '$admin-components';
import { invalidateAll } from '$app/navigation';
import { navigating } from '$app/state';
import AdminShell from '$lib/AdminShell.svelte';
import { ADMIN_COMPONENTS_CONTEXT } from '$lib/component-registry.js';
import type { LayoutProps } from './$types';

let { data, children }: LayoutProps = $props();
setContext(ADMIN_COMPONENTS_CONTEXT, adminComponents);
</script>

<AdminShell state={data.admin} activePath={data.path} loading={navigating.to !== null} onretry={() => invalidateAll()}>
    {@render children()}
</AdminShell>
