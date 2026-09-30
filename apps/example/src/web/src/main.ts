import { hydrate, mount } from 'svelte';
import App from './App.svelte';
import { publicConfig } from './nestrum';

const target = document.getElementById('app') as HTMLElement;
const props = { publicEnv: publicConfig };

// A server-rendered page is hydrated; a static (non-SSR) host serves an empty container that is mounted.
if (target.hasChildNodes()) {
    hydrate(App, { target, props });
} else {
    mount(App, { target, props });
}
