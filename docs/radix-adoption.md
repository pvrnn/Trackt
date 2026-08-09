# Radix adoption

Status of hand-rolled React in `apps/web` that a Radix primitive does better.
Everything under "Shipped" is done; the rest is deliberately parked.

## The rule

Radix is a **behaviour** dependency, never a looks one. Every adoption keeps AURA PRISM
styling exactly as-is (`docs/design/README.md` tokens are final) and deletes only the
keyboard/focus/ARIA plumbing underneath. Do not run `shadcn init` or adopt a pre-styled
kit — see the decision note in `ROADMAP.md`.

Conventions established along the way:

- **Radix reserves `''`** for its own "nothing selected" state. Options that genuinely mean
  none need a sentinel (`__none__` in `ui/Select.tsx`, `'all'` in the search filter row)
  confined to the component or route, so the rest of the app keeps its natural values.
- **A tooltip trigger must be focusable.** Inert `<span>` placeholders need `tabIndex={0}`
  or the copy stays mouse-only — the tooltip alone doesn't fix that.
- **`asChild` is how styling survives.** `ui/Chip` and `ui/Button` are passed straight into
  `ToggleGroup.Item` / `AlertDialog.Cancel` rather than restyled.

---

## Shipped

| Component                       | Primitive        | What it fixed                                                                                                                                              |
| ------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui/Select`                     | `select`         | OS-drawn popup ignoring the design system; native `<select>` behind the `＋ LOG` / `RATE` pills and the create-entry Status field                            |
| `layout/AppNav` `AccountMenu`   | `dropdown-menu`  | Focus never entered the menu on open; no ↑/↓, Home/End, typeahead, or focus return. Deleted ~15 lines of hand-rolled Escape/outside-click                    |
| `ui/Modal`                      | `dialog`         | Page scrolled behind the open dialog; background wasn't `inert`; name came from `aria-label` rather than the visible heading. Deleted a ~60-line focus trap |
| `ui/ConfirmDialog` _(new)_      | `alert-dialog`   | Destructive list delete was a plain dialog — now `role="alertdialog"`, focus defaults to Cancel, outside click can't answer it                              |
| `ui/Avatar`                     | `avatar`         | **Real bug:** fallback branched on `src` alone, so a 404'd upload rendered a broken-image icon instead of the gradient initial                              |
| `routes/search` kind chips      | `toggle-group`   | Six filter chips were six tab stops; now one, with arrow-key movement                                                                                       |
| `ui/Tooltip` _(new)_            | `tooltip`        | 7 native `title=` attributes, invisible to keyboard users and ~1s slow                                                                                      |
| `media/RatingPopover` _(new)_   | `popover` + `toggle-group` | The 0–10 half-point scale is 21 values — unusable as a dropdown. Now a star row at half-star precision inside a popover                          |

Notes worth keeping:

- `ModalTitle` is not optional. Radix derives the dialog's accessible name from
  `Dialog.Title`, so a modal without one is unnamed.
- `ConfirmDialog` deliberately does **not** use `AlertDialog.Action` — that closes on
  select, which would tear the dialog down mid-request and lose the busy state.
- `Tooltip` does not open on touch. That is Radix's deliberate behaviour, not a gap to
  work around; genuinely essential copy belongs on screen.
- `RatingPopover` keeps `0` on its own pill: ten stars at half precision span 0.5–10, so
  without it the scale's lowest value would be unreachable. Clicking the current score again
  clears the rating, which is `ToggleGroup`'s deselect behaviour rather than a custom gesture.
- The `aria-hidden` exclusion once added to `Modal`'s `FOCUSABLE` list is gone — it existed
  to stop the hand-rolled trap grabbing Radix Select's hidden form input, and the trap
  itself no longer exists.

---

## Parked — blocked on features that don't exist

### Lists scope tabs → `tabs`

`routes/lists.tsx:57-74`

MY LISTS is hardcoded `selected`; FRIENDS and COLLABORATIVE are inert (now tooltipped)
spans, because FRIENDS needs a friends-scoped lists endpoint (ADR-0006 phases 1–2 landed
the relationship layer, not this) and COLLABORATIVE needs a membership table. These
aren't tabs yet — they're one active chip and two placeholders. Adopt `Tabs` when the
scopes actually switch panels.

### Profile visibility → `switch`

`routes/profile.tsx:243-250`

Static text reading `PRIVATE`. Becomes a real `Switch` when profile visibility ships in v1.x.

---

## Deliberately not adopting

- **Episode/chapter checklist** (`media.$slug.tsx:425+`) — `<button aria-pressed>` is a
  legitimate toggle-button pattern, and Radix `Checkbox` would fight the custom row layout.
- **Favourite toggle** (`media.$slug.tsx:359`) — `toggle` is a near-empty wrapper over the
  `aria-pressed` button already there.
- **PRISM progress bars** (`CoverCard.tsx:33-38`) — intentionally `aria-hidden`, with the
  same progress carried in adjacent text. `Progress` would add a redundant announcement.
- **Drag reordering** (backlog) — Radix has no drag-and-drop primitive. The ↑/↓ buttons at
  `lists.$id.tsx` are already keyboard-accessible; pointer dragging would be dnd-kit.
- **`Separator`, `Label`, `ScrollArea`** — dividers are one `border-t`, `ui/Input.tsx`
  already wires `htmlFor`, and custom scrollbars are cosmetic only.

---

## Bundle

Seven primitives, measured from the production client build:

- Client assets went from **1.1 MB → 1.2 MB** raw across the six additions after Select.
- The marginal cost collapses as predicted: `Select`'s own chunk fell from **28.8 kB → 7.1 kB**
  gzipped once `react-primitive`, `react-context`, `react-popper`, `react-dismissable-layer`
  and `react-focus-scope` were hoisted into a chunk shared with dialog, dropdown-menu,
  tooltip and the rest.

Treat the first Radix primitive on a page as the expensive one and the rest as nearly free.
