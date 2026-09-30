# Nestrum Admin design system

Nestrum Admin is the look of the Nestrum administration shell: the screens the framework generates from resource metadata so people can list, create, edit, act on and delete records. The direction is **Soft Modular**: calm violet on a lavender-grey canvas, every job in its own floating card, pill-shaped actions and generous 40px controls. It must stay easy to read in light and dark, and every screen must be buildable from metadata alone.

## Status

This is the agreed design direction and its token source. The shipped shell (`packages/admin-ui`) does not use it yet: `AdminShell.svelte` and the resource components still carry their own minimal styles. Restyling them is separate work that should follow this document.

## Files

- [`packages/admin-ui/src/lib/theme/tokens.json`](../../packages/admin-ui/src/lib/theme/tokens.json): the token source. Every color has a light and a dark value and a usage note naming the grounds it is legible on.
- [`packages/admin-ui/src/lib/theme/tokens.css`](../../packages/admin-ui/src/lib/theme/tokens.css): CSS custom properties generated from it with `pnpm --filter @nestrum/admin-ui tokens`. Never edit it by hand; `packages/admin-ui/tests/tokens.test.ts` fails when it is out of date or when a documented contrast pairing drops below its minimum.
- [Accessibility](accessibility.md): the contrast table and the accessibility rules.
- [Building screens](building-screens.md): which metadata feeds each module, and the screen recipes.
- [Components](components.md): the component inventory and the rules for each.

## Using this system

- Style admin screens only through the custom properties in `tokens.css`: `var(--violet)`, `var(--space-4)`, `var(--radius-lg)`, `font: var(--type-body)`. Never paste a hex value, font stack or pixel value that exists as a token.
- Light is the default theme. Dark applies when the operating system prefers it, and `data-theme="light"` or `data-theme="dark"` on `<html>` overrides the system in either direction. Components never check the theme themselves.
- Render from data. Navigation comes from the registered resources, table columns from `listDisplay`, forms from field metadata. Adding a field or a resource must never need new markup.
- A new color, size or radius is a token first, with a usage note, and any new text or control pairing is added to the accessibility table and the token test in both themes.
- The `--type-*` properties are `font` shorthands; `page-title` also takes `letter-spacing: -0.02em`.

## Voice

Write from the admin's side of the screen, plainly, in sentence case, without exclamation marks or emoji.

- Buttons are verbs that say what happens: “New project”, “Create”, “Save changes”, “Apply”, “Archive”, “Delete”.
- Outcomes are short past-tense sentences: “Changes saved.”, “Record deleted.”, “Action completed.”
- Errors say what went wrong and what to do: “Unable to connect. Please try again.”, “Must be at least 3 characters.”
- Use the metadata's own words for labels and values (“Owner ID”, “active”, “archived”). Do not rename them in the UI.
- Missing values read “Not set”; empty lists read “No records found.”
- Placeholders in designs are bracketed: `[record id]`, `[account email]`. Never invent names or figures.

## Color

- `canvas` is the ground and the sidebar; `surface` cards float on it with `shadow-card`. Use `surface-subtle` for table headers, card footers, read-only values and hovers.
- Text is `ink`; secondary text is `ink-muted`. Sidebar text uses `nav-ink` and `nav-ink-muted`.
- `violet` is the brand and the one primary action per view, with `on-violet` text. Links and the table's Open action are `violet-ink`. Selected rows and the accent pill use `violet-soft`.
- `danger` only for errors and destructive actions; `success-ink` only for confirmations. Both always come with an icon and words.
- Control edges use `control` (3:1 or better); `line` is for decorative hairlines only.

## Type

Figtree for everything people read, DM Mono for identifiers. Both load from Google Fonts: `family=DM+Mono:wght@400;500&family=Figtree:wght@400;500;600;700`.

- One `page-title` per screen; `card-title` for card headings; `body` for text; `label` for field labels, nav and buttons; `small` for hints and footers; `caption` (12px, the minimum) for column headers and pills.
- Use `identifier` or `code-small` (DM Mono) for model identities (`default.Project`), record IDs and JSON.
- Sentence case everywhere; no all-caps labels.

## Shape, space and layout

- The card is the module: `radius-lg`, `line` border, `shadow-card`, one job each. Cards never nest.
- Controls use `radius-sm`; buttons, pills, the value-handling select and switches use `radius-pill`.
- Spacing is a 4px scale: `space-4` between fields and between cards, `space-5` inside cards, `space-6` around the main area.
- Screen layout: `sidebar-width` sidebar on canvas, then the main area with PageHeader, an optional Message, and cards. The list and record pages may dock the edit form (370px) beside the RecordTable; a standalone form is at most `form-width`.
- Controls are `control-md` (40px) high; toolbars use `control-sm`. Table rows are `row` (48px).

## Iconography

Line icons on a 24px grid, 1.75px stroke, round caps and joins, drawn in `currentColor` so they take the text color. The set: plus, check, alert, info, chevron, trash, spinner, grid (Overview), folder (a resource), file (a document resource), signout. Icons always sit beside a word, except icon-only buttons, which need an `aria-label`. No emoji. There is no logo yet: the brand mark is the letter N in a `radius-sm` outlined square beside the word “Nestrum”; replace it when a real mark exists.

## Motion

Almost none. The only animation is the busy button's spinner, which stops under `prefers-reduced-motion`. Hover changes fills; nothing slides or bounces.
