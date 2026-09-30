# Accessibility

Every pairing below is checked in both themes (WCAG 2.2 contrast) by `packages/admin-ui/tests/tokens.test.ts`. Text must reach 4.5:1; control edges, focus indicators and meaningful icons must reach 3:1.

| Foreground | On | Light | Dark |
| --- | --- | --- | --- |
| `ink` | `surface` | 17.3:1 | 15.5:1 |
| `ink` | `canvas`, `surface-subtle`, `input`, `violet-soft` | ≥ 14.7:1 | ≥ 13.1:1 |
| `ink-muted` | `surface`, `canvas`, `surface-subtle`, `input` | ≥ 6.2:1 | ≥ 6.9:1 |
| `nav-ink` | `canvas`, `surface-subtle` | ≥ 10.3:1 | ≥ 10.3:1 |
| `nav-ink-muted` | `canvas` | 5.6:1 | 6.7:1 |
| `nav-active-ink` | `nav-active` | 8.5:1 | 10.6:1 |
| `on-violet` | `violet` | 7.1:1 | 7.8:1 |
| `violet-ink` | `surface`, `violet-soft` | ≥ 7.2:1 | ≥ 7.9:1 |
| `danger` | `surface`, `input`, `danger-soft` | ≥ 5.7:1 | ≥ 7.5:1 |
| `success-ink` | `success-soft`, `surface` | ≥ 5.3:1 | ≥ 9.3:1 |
| `control` (edges) | `input`, `surface`, `surface-subtle` | ≥ 3.3:1 | ≥ 3.3:1 |
| `focus` (outline) | `canvas`, `surface`, `input` | ≥ 6.3:1 | ≥ 7.7:1 |

## Rules

- **Keyboard focus** is a solid 2px `focus` outline with a 2px offset on every interactive element, plus the `focus` border on inputs. Never remove it.
- **Never color alone.** Errors carry an alert icon and a sentence; status messages a check icon; the selected table row also reads “Editing”; switches move their knob; pills always show their word.
- **Real elements.** `button` for actions, `a href` for navigation, `input`/`select`/`textarea` with a visible `label`, `table` with a caption for records. Never add `role` or `onClick` to a div.
- **Names.** Icon-only buttons need `aria-label`; the value-handling select is named “<Field> value handling”; each Open link carries the record id for screen readers.
- **Live feedback.** Outcomes use `role="status"`, failures `role="alert"`. Field errors are linked to the control with `aria-describedby` and set `aria-invalid`.
- **Targets and text.** Controls are at least 40px high; text is never smaller than `caption` (12px); body copy is 14px at 20px line height.
- **Motion** respects `prefers-reduced-motion`.
- **Zoom.** Layouts wrap (page header, toolbars, tables scroll inside their own container) so 200% zoom never scrolls the page sideways.
