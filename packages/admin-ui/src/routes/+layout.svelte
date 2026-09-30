<script lang="ts">
import { setContext } from 'svelte';
import adminComponents from '$admin-components';
import { goto, invalidateAll } from '$app/navigation';
import { navigating, page } from '$app/state';
import AdminShell from '$lib/AdminShell.svelte';
import { ADMIN_COMPONENTS_CONTEXT } from '$lib/component-registry.js';
import { safeReturnTo, withNext } from '$lib/return-to.js';
import type { LayoutProps } from './$types';

let { data, children }: LayoutProps = $props();
setContext(ADMIN_COMPONENTS_CONTEXT, adminComponents);
</script>

<AdminShell
    state={data.admin}
    activePath={data.path}
    loading={navigating.to !== null}
    onretry={() => invalidateAll()}
    ontwofactor={() => goto(withNext('/admin/auth/2fa', safeReturnTo(`${page.url.pathname}${page.url.search}`)))}
>
    {@render children()}
</AdminShell>
