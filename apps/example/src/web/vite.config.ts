import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// The consuming project owns this Vite project; `nestrum build` and `nestrum dev` drive it.
export default defineConfig({ plugins: [svelte()] });
