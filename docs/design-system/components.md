# Components

The inventory the admin shell is built from. Each entry states the rules and what the consumer supplies. The names describe roles, not files: a Svelte implementation may split or merge them, but must keep the behavior and the tokens named here. Where a Nestrum component already exists, it is noted.

Existing counterparts in `packages/admin-ui/src/lib`: Sidebar ↔ the nav in `AdminShell.svelte`; RecordTable ↔ `ResourceTable.svelte` (toolbar in `ResourceList.svelte`); ResourceForm ↔ `ResourceForm.svelte`; Field, Input, Textarea, Select, ValueHandling and ReadOnlyValue ↔ `FieldRenderer.svelte`; the Actions card ↔ `ResourceActions.svelte`; the Delete card ↔ `ResourceDelete.svelte`.

## Sidebar

The admin's navigation, built from the registered resources: Overview, then a “Resources” heading and one link per resource in registration order.

- It sits on `canvas` with no panel of its own; the current item is a raised `nav-active` tile with `nav-active-ink` text, weight 700 and `aria-current="page"`.
- The current item stays current on the resource's list, new and record pages.
- Account email and Sign out sit at the bottom.
- Labels are the resource labels from metadata. Never hand-maintain the list.

Consumer provides: `items` (from metadata), `account`, `onSignOut`.

## PageHeader

Breadcrumb, the one `page-title` per screen, the model identity chip and the page's primary action.

- Breadcrumbs: Administration / Resource / New or [record id]. The last crumb is the current page.
- The identity chip shows `database.Model` in `mono` (default.Project, documents.Article).
- Put at most one primary Button in `actions`.

Consumer provides: `title`, `crumbs`, and optionally `identity`, `description`, `actions`.

## Card

The modular unit of every screen: a `surface` tile with `radius-lg`, a `line` border and `shadow-card`, floating on `canvas`.

- One job per card: the record table, the edit form, actions, delete.
- Optional header (`card-title`, plus meta such as a mono record id) and footer (`surface-subtle`, primary action first).
- Cards sit in flex or grid layouts with `space-4` gaps; never nest a card in a card.
- Render as `form` when the card is a form.

Consumer provides: `title`, children, and optionally `meta`, `footer`, `as`.

## RecordTable

The resource list: a real `table` whose columns come from `listDisplay` and whose rows are records.

- Column headers use the field labels in `caption` style; the last column is “Record” with an Open link (with a hidden record id for screen readers).
- The row being edited is tinted `violet-soft` and reads “Editing” instead of Open.
- Empty cells read “Not set”; no rows reads “No records found.”
- Right-align numbers with tabular figures (`align: 'end'`).
- Sorting and limits live in a toolbar above it (Order by, Maximum records, Apply), not in clickable headers.

Consumer provides: `columns`, `rows`, `getHref`, and optionally `selectedKey`, `caption`, `emptyText`.

## ResourceForm

Renders a whole create or edit form from field metadata: the data-driven heart of the admin. Adding a field to a resource adds it to the form with no new markup.

Widget mapping (the same order Nestrum uses):

| Metadata | Renders |
| --- | --- |
| `readOnly`, or not writable in this mode, or `widget: 'readonly'` | ReadOnlyValue |
| `widget` naming a registered custom widget | that component, inside Field |
| `array` | Textarea with “Enter a JSON array.” |
| `enumValues` | Select |
| `kind: 'boolean'` | Select of true / false |
| `kind: 'integer'` or `'number'` | Input `type="number"` |
| `widget: 'date' / 'datetime-local' / 'time'` | Input of that type, label + “(UTC)” for dates |
| anything else | Input `type="text"` |

- Update mode leads with the help Message and defaults every field to “Keep existing value”.
- Server errors arrive as `errors[fieldName]`; the form never invents validation copy.
- Footer: the primary Save changes or Create first, then an optional secondary action.

Consumer provides: `fields` (AdminFieldMetadata), `mode`, `record`, `errors`, `onSubmit`, and optionally `widgets` for custom widgets.

## Field

Field is the frame every form control sits in: label, optional value-handling select, the control, a hint and the error list, in that order.

- The control gets the field's `id`, `aria-describedby` pointing at the hint and errors, and `aria-invalid` when there are errors.
- The label is always visible text. Never use a placeholder as a label.
- Mark required fields on create with `required` (a muted `*` plus the native `required` attribute). Say “Fields marked * are required.” once under the page title.
- Hints explain the rule before it is broken (“At least 3 characters.”). Errors come from the server, one per line, in `danger` with an alert icon; they replace nothing, the hint stays.
- Date and date-time labels end in “(UTC)”.

Consumer provides: `htmlFor` (unique per page), `label`, the control, and optionally `required`, `hint`, `errors`, `valueHandling`.

## Input

A single-line native input for the `text`, `number`, `date`, `datetime-local` and `time` widgets.

- Always inside a Field. Height `control-md`, fill `input`, border `control`, corners `radius-sm`.
- Pick `type` from the widget; never build a custom date picker when the native one works.
- Focus shows the `focus` border and a 2px `focus` outline; invalid shows the `danger` border.

Consumer provides: `name`, `type`, `defaultValue` or `value` with `onChange`.

## Textarea

Multi-line text for the `textarea` widget and for array fields.

- Minimum height 84px, vertical resize only.
- Array fields use the `mono` family and the hint “Enter a JSON array.”
- Action inputs on the record page are a Textarea in `mono` labelled “<Action> input (JSON)”.

Consumer provides: `name` and a value.

## Select

A native select for the `enum` and `boolean` widgets and for toolbar choices (Order by, Maximum records).

- The first option is “Choose a value” unless `placeholder={false}`.
- Show enum values exactly as the metadata spells them (“active”, “archived”).
- Booleans stay a select of “true” / “false” in forms, so “Keep existing value” and “Set to null” still work; use Switch only for settings that apply immediately.

Consumer provides: `options` (strings or `{value, label}`), `name`, a value.

## ValueHandling

The compact pill select in a field's header that says what the save does to that field. It is how Nestrum tells “leave it alone” from “clear it”.

| Option | Shown when |
| --- | --- |
| Set value | always |
| Keep existing value | editing a record (the default there) |
| Use default / leave unset | creating, for optional fields (the default there) |
| Set to null | the field is nullable |

- Posts as `mode:<field>` beside the field's value.
- Returns nothing when only “Set value” applies (a required, non-nullable field on create).
- When the person edits the control, switch it to “Set value”.

Consumer provides: `mode`, `required`, `nullable`, `label`, `fieldName`, and the selected mode.

## ReadOnlyValue

Shows a value the person cannot change on this screen: primary keys, fields outside the update schema, the `readonly` widget.

- A “Read only” tag after the label, the value in `mono` on `surface-subtle` with a dashed `control` border.
- Empty values read “Not set”.

Consumer provides: `label`, `value`.

## Checkbox

A native checkbox with its label as the click target, in `violet` when checked.

- Use for confirmations (“Confirm permanent deletion”) and independent opt-ins.
- Write the label as the statement that becomes true when checked.

Consumer provides: `label`, `name`, and a checked state.

## Switch

A `button role="switch"` for settings that take effect immediately, such as view preferences.

- Never inside a form that has a Save button; use Checkbox or a boolean Select there.
- Off is an outlined track with an `ink-muted` knob; on is a `violet` track with an `on-violet` knob, so state reads without color.

Consumer provides: `label`, `checked` with `onChange` (or `defaultChecked`).

## Button

Buttons state exactly what happens, verb first, in sentence case: “Save changes”, “Create”, “Delete”. Every button is a pill (`radius-pill`) at `control-md` height, `control-sm` in toolbars and cards.

- **primary** (`violet` fill, `on-violet` text): at most one per view, for what the screen is for: New project, Create, Save changes.
- **secondary** (`surface` fill, `control` border): everything else that acts: Apply, Sign out, Archive.
- **ghost**: leaving without acting: Cancel.
- **danger** (`danger` text and border, no fill): destructive actions, always behind a confirmation such as “Confirm permanent deletion”.
- `busy` swaps the icon for a spinner, disables the button and sets `aria-busy`; change the label to the progress form (“Saving…”, “Deleting…”, “Running…”).
- Use a link styled as a button for navigation (New project goes to a page) and a real `button` for anything that submits.

Consumer provides: the label (children), `variant`, and `onClick`, `type="submit"` or `href`.

## StatusPill

One or two words of record state in a table cell or beside a title, always with its text.

- `accent` for the live or default state (active), `neutral` for retired states (archived, draft), `success` and `danger` only for outcomes.
- Keep the value's own spelling from the metadata.

Consumer provides: `tone`, the words.

## Message

A full-width line of feedback at the top of a page or form.

- **status** (`role="status"`, check icon): something finished. Past tense, one sentence: “Changes saved.”, “Record deleted.”, “Action completed.”
- **alert** (`role="alert"`, alert icon): something failed. Say what went wrong and what to do: “Unable to connect. Please try again.”
- **help** (info icon): standing guidance that is not an outcome.
- One message per region. Never rely on color: the icon and the words carry the meaning.

Consumer provides: `tone`, the sentence.
