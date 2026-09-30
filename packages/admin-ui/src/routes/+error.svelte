<script lang="ts">
import { page } from '$app/state';
</script>
<svelte:head><title>Administration unavailable</title></svelte:head>
<h1>{page.status === 404 ? 'Resource not available' : 'Unable to open this page'}</h1>
<p>{page.status === 404 ? 'Choose an available resource from the navigation.' : 'Please try again.'}</p>
<a href="/admin">Return to administration</a>
