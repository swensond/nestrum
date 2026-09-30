import type { AdminFieldMetadata } from '@nestrum/admin';
import type { Component } from 'svelte';
import type { FormMode } from './fields.js';

export type AdminWidgetProps = {
    field: AdminFieldMetadata;
    mode: FormMode;
    id: string;
    name: string;
    value: string;
    required: boolean;
    errors: string[];
    onchange: (value: string) => void;
};
export type AdminWidget = Component<AdminWidgetProps>;
export const ADMIN_COMPONENTS_CONTEXT = 'nestrum:admin-components';

export class AdminComponentRegistry {
    private readonly widgets = new Map<string, AdminWidget>();
    private sealed = false;

    register(name: string, component: AdminWidget): this {
        if (
            this.sealed ||
            !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(name) ||
            typeof component !== 'function' ||
            this.widgets.has(name)
        ) {
            throw new Error(
                'Admin widgets require unique safe names and components; registration must precede sealing.',
            );
        }
        this.widgets.set(name, component);

        return this;
    }

    get(name: string): AdminWidget | undefined {
        return this.widgets.get(name);
    }

    seal(): this {
        this.sealed = true;

        return this;
    }
}

export function createAdminComponentRegistry(): AdminComponentRegistry {
    return new AdminComponentRegistry();
}
