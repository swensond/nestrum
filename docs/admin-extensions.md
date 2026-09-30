# Admin extensions

Phase 14 supports explicit field widgets and per-record actions on the existing generic routes. Applications own extension code; metadata carries names and labels only.

## Resource configuration and actions

```ts
import { defineAdmin } from '@nestrum/admin';
import { z } from 'zod';

const admin = defineAdmin();
admin.register(Project, {
    listDisplay: ['id', 'name', 'status'],
    fields: { description: { widget: 'textarea' }, metadata: { widget: 'json-editor' } },
    actions: {
        archive: {
            label: 'Archive',
            input: z.object({}).strict(),
            async handler({ objects }) {
                return objects.update({ status: 'archived' });
            }
        }
    }
});
```

`Project` is an ordinary registered resource with these fields. Its policy must grant `read` and the custom `archive` action. To use `objects.update`, that action must declare `operations: ['update']`; collection scopes such as `eq('ownerId', subject.id)` apply to the write. No public API flag is required.

`POST /__admin/:slug/:id/actions/:action` accepts a JSON object (an absent body means `{}`). The optional Zod `input` schema parses asynchronously before authorization, and its output must also be an object. The private API checks a live session, `admin.access`, origin, the ordinary resource action grant, a read scoped by both read and action policies, and the action's object decision before invoking the handler. Denied handlers never execute. An object denial or target outside the intersected scopes returns 404.

The handler receives `AdminActionContext`: application, registered resource, a copied readonly record, a primary-key-filtered QuerySet bound to the custom action, trusted subject/environment, request, and validated input. QuerySet terminals independently enforce their operation grants, schemas, and scopes. Their policy input is the terminal's mutation input, so invocation input grants do not replace write authorization. Handlers are awaited within the request pipeline. They return `undefined` for 204 or a serializable result for 200 `{ result }`; native dates and bigints use existing wire encoding. Failures use the existing safe HTTP error boundary and server error observer.

Handlers remain trusted application code. Direct raw backend access bypasses QuerySet protection as elsewhere in Nestrum. Checking the record and performing the handler's writes are separate operations, without an automatic transaction. QuerySet updates/deletes still reject arbitrary object policies until atomic object mutation support exists. Metadata-only actions without a handler retain the earlier authorized 501 response.

The generic detail page renders known actions as native POST forms with JSON input. Submissions reload current metadata and forward to the private API; successful calls redirect to fresh record data. The UI does not display returned results or synthesize schema-specific action forms. Capability metadata is advisory: input-dependent policies can hide an action during discovery, and object policies remain authoritative during execution.

## Field widgets

`fields.<name>.widget` selects a built-in widget or a registered component. Built-ins are `text`, `textarea`, `number`, `boolean`, `enum`, `date`, `datetime-local`, `time`, and `readonly`. Unknown names fall back to metadata inference. Readonly fields always render readonly even if a custom widget is registered. `widget: 'readonly'` is presentation; use `readOnly: true` to reject explicit backend field writes.

Create a browser-safe module alongside the application's Svelte components:

```ts
import { createAdminComponentRegistry } from '@nestrum/admin-ui';
import JsonEditorField from './JsonEditorField.svelte';

export const adminComponents = createAdminComponentRegistry();
adminComponents.register('json-editor', JsonEditorField);
export default adminComponents.seal();
```

Build the shell using an absolute module path:

```bash
NESTRUM_ADMIN_COMPONENTS="$PWD/src/admin-components.ts" pnpm --filter @nestrum/admin-ui build
```

The selected module's default export is the registry used by both SSR and browser bundles. `createAdminShell()` then hosts that compiled shell as usual; changing widgets requires rebuilding it. The default prebuilt shell has an empty sealed registry. No component paths, executable code, or dynamic imports arrive through backend metadata. Avoid importing server credentials or backend handlers into the component entry.

Names must match `[A-Za-z][A-Za-z0-9_.-]*`, be unique, and register before sealing. Component registries are explicit instances, so separate shells/tests can use separate configurations. Reusable `ResourceCreate`, `ResourceEdit`, `ResourceForm`, and `FieldRenderer` also accept an optional `components` registry; the shell supplies its registry through Svelte context.

Components implement `AdminWidgetProps`: field metadata, create/update mode, id, field name, string value, required flag, errors, and an `onchange(value)` callback. Render one native form control with the supplied `name` and `id`, preserve string values, expose required/error accessibility, and call `onchange` when edited so the form selects “Set value.” Existing conversion handles native wire types; server schemas remain authoritative. Null/default/unchanged handling stays in the generic form. See the [test widget](../packages/admin-ui/tests/CustomWidget.svelte) for a minimal example.

See [extension contribution seams](extension-seams.md) for app ownership and future CLI/database boundaries, and [ADR 0012](decisions/0012-admin-extension-boundaries.md) for the build-time decision.
