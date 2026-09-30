# Building screens

The admin is generated, so the design is a set of modules fed by metadata. Keep it that way: a screen is a composition of components, and every repeated thing comes from data.

## The data each module reads

| Module | Fed by |
| --- | --- |
| Sidebar | the registered resources (label, path) plus Overview |
| PageHeader | resource label, model identity (`database.Model`), capabilities (show New only with `create`) |
| RecordTable | `listDisplay` columns, the fields' labels, the records |
| ResourceForm | field metadata (`kind`, `required`, `nullable`, `array`, `enumValues`, `widget`, `readOnly`) and the record |
| Actions card | the resource's `actions` (label, name); one Card with a JSON Textarea and a secondary Button each |
| Delete card | the `delete` capability; Checkbox “Confirm permanent deletion” plus a danger Button |

## Screens

- **Sign in**: centered Card (max 400px) on canvas; Email, Password, primary “Sign in”; the server message above the fields; failures as an alert Message.
- **Overview**: PageHeader “Administration”, then one Card per resource in a grid (identity chip, Open, New).
- **Resource list**: PageHeader with the primary New action, optional status Message, a Card holding the toolbar (Order by, Maximum records, Apply) and the RecordTable, footer “Showing up to N records.”
- **Record**: PageHeader with the record id; ResourceForm in update mode; beside or below it the Actions and Delete cards.
- **New record**: PageHeader “New <resource>”, “Fields marked * are required.”, ResourceForm in create mode with Create and Cancel.
- **Denied or unavailable**: a single Card with the server's message and “Try again”.

## Extending

- A new field kind gets a row in ResourceForm's widget mapping and, if needed, a new control component that renders inside Field. It never gets one-off markup on a single screen.
- A custom widget registered by an app renders inside Field with the same label, value handling, hint and errors.
- A new color, size or radius is a token first, with a usage note, checked against the Accessibility table in both themes.
