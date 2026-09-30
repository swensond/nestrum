export type { AdminWidget, AdminWidgetProps } from './component-registry.js';
export {
    ADMIN_COMPONENTS_CONTEXT,
    AdminComponentRegistry,
    createAdminComponentRegistry,
} from './component-registry.js';
export type { AdminRecord, FieldErrors } from './crud.js';
export { AdminCrudError, AdminResourceClient, recordHref, recordId } from './crud.js';
export type { FieldWidget, FormFeedback, FormMode, ValueMode } from './fields.js';
export { displayValue, fieldWidget, initialValueMode, inputValue, parseResourceForm, writable } from './fields.js';
export type { AdminFetch, AdminShellState } from './metadata.js';
export { ADMIN_METADATA_SCHEMA, AdminMetadataClient, AdminMetadataError, loadAdminState } from './metadata.js';
export type { AdminView, AdminWorkspace } from './routes.js';
export { resourceHref, selectWorkspace } from './routes.js';
