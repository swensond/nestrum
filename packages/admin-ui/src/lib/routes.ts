import type { AdminResourceMetadata } from '@nestrum/admin';
import type { AdminShellState } from './metadata.js';

export type AdminView = 'list' | 'new' | 'detail';
export type AdminWorkspace = {
    readonly resource: AdminResourceMetadata;
    readonly view: AdminView;
    readonly id?: string;
};

export function resourceHref(resource: Pick<AdminResourceMetadata, 'slug'>): string {
    return `/admin/${encodeURIComponent(resource.slug)}`;
}

export function selectWorkspace(
    state: AdminShellState,
    slug: string,
    view: AdminView,
    id?: string,
): AdminWorkspace | null {
    if (state.status !== 'ready') {
        return null;
    }
    const resource = state.resources.find((candidate) => candidate.slug === slug);
    if (!resource) {
        return null;
    }
    const allowed =
        view === 'new'
            ? resource.capabilities.create
            : view === 'list'
              ? Object.values(resource.capabilities).some(Boolean)
              : resource.capabilities.retrieve || resource.capabilities.update || resource.capabilities.delete;
    if (!allowed) {
        return null;
    }

    return { resource, view, ...(id === undefined ? {} : { id }) };
}
