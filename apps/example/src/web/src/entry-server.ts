import type { SsrRender } from '@nestrum/web';
import { render as renderApp } from 'svelte/server';
import App from './App.svelte';

// Nestrum calls this for HTML navigations. The template is the built index.html with public config embedded.
export const render: SsrRender = (_request, { template, publicEnv }) => {
    const { body, head } = renderApp(App, { props: { publicEnv } });

    return new Response(template.replace('<!--ssr-outlet-->', body).replace('</head>', `${head}</head>`), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
    });
};
