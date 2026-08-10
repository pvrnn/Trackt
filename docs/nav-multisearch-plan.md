# Nav bar multisearch dropdown (media + people)

## Context

The nav bar search (`NavSearch` in `apps/web/src/components/layout/AppNav.tsx:99`) looks like a
typeahead — pill, `⌕`, `⌘K` hint — but does nothing while you type: it holds local state and only
navigates to `/search?q=` on Enter. It is also hidden entirely on `/search`. Meanwhile user search
exists but is buried inside `AddFriendDialog`, reachable only from `/profile`.

The goal: make the nav search a real multisearch. Typing shows a dropdown with **media results
first, people below**, each row navigating to the right page. Enter still carries the query to
`/search` so nothing regresses.

Decisions taken with the user:
- User rows **navigate to `/users/$username` only** — no inline add-friend button. The profile page
  already owns that action; the nav stays free of mutation state.
- The nav search **renders everywhere, including `/search`** (today it returns `null` there).
- The `/search` Discover page is **not** changed to show people — nav dropdown only.

## Approach

### 1. Shared debounce hook (new) — `apps/web/src/lib/use-debounced.ts`

The 200 ms `setTimeout` idiom is hand-rolled in two places already
(`routes/search.tsx:49`, `components/social/AddFriendDialog.tsx:37`) and the nav needs a third.
Extract:

```ts
export function useDebounced<T>(value: T, delayMs = 200): T
```

Refactor `AddFriendDialog` to use it. Leave `routes/search.tsx` alone — its timer debounces a
*router navigation*, not a value, so it is not the same shape.

### 2. Extract `NavSearch` into its own file — `apps/web/src/components/layout/NavSearch.tsx`

`AppNav.tsx` is already ~200 lines; the dropdown roughly doubles `NavSearch`. Move it out and import
it from `AppNav` (which keeps `AccountMenu`). No behaviour change to `AppNav` itself beyond the
import.

### 3. The dropdown

Data — reuse both existing hooks unchanged, side by side, on one debounced string:

- `useMediaSearch(q)` — `apps/web/src/lib/search.ts:19`
- `useUserSearch(q)` — `apps/web/src/lib/friends.ts:43`

Notes that shape the implementation:
- Gate both at **`q.trim().length >= 2`** (`useUserSearch` already enforces this; `useMediaSearch`
  fires at 1). One gate keeps the two sections appearing together, and both endpoints sit behind a
  **60 req/min per-IP** limit (`apps/api/src/routes/v1/search.ts`, `.../users.ts:25`) — two requests
  per settle. Use a **250 ms** debounce rather than 200 ms for the same reason.
- Do **not** add a `limit` param to `useMediaSearch`: keeping the key `['search', q, undefined]`
  identical to the Discover page's means pressing Enter renders `/search` from cache instantly.
  Slice client-side instead — **6 media, 4 people**.
- Both hooks already pass `signal` and use `keepPreviousData`, so superseded keystrokes abort and
  the panel doesn't flicker.
- `AppNav` only mounts for a signed-in user, so `users/search` (401 for anonymous) is safe here.

Presentation — Radix `Popover` (already a dependency; `components/media/RatingPopover.tsx` is the
styling template):
- `Popover.Root open={…} modal={false}` with `Popover.Anchor` wrapping the existing `<form>`, so the
  input keeps focus and is never re-parented.
- `Popover.Content` with **`onOpenAutoFocus={e => e.preventDefault()}`** and
  `onCloseAutoFocus={e => e.preventDefault()}` — focus must stay in the input. Nothing in the repo
  does this yet; it is the one non-obvious Radix detail here.
- `align="end" sideOffset={8}`, width matched to the pill (widen to ~`w-[420px]`), `z-20`,
  `max-h-[70vh] overflow-y-auto`, glass panel classes copied from `AccountMenu`'s content.
- Open when gated + focused; close on Escape, blur outside, route change, or selection.

Rows:
- **Media** — small horizontal rows (not `CoverCard`, which is a grid tile): 32×48 cover thumb from
  `result.coverUrl`, title, then `<KindDot kind showLabel />` · year as the caption. Links to
  `/media/$slug`.
- **People** — reuse the exact row markup from `AddFriendDialog.tsx:132-141`
  (`Avatar` + name + `@username`), minus the action button. Links to `/users/$username`.
- Section headers styled like `AddFriendDialog`'s: `font-label text-xs tracking-label text-dim` —
  `TITLES` and `PEOPLE`. Hide a section entirely when it has no results and the other does.
- Footer row: `See all results for “q”` → `/search?q=…`.

States: loading skeleton rows while both are pending with no kept data; per-section empty text; a
combined "Nothing matches “q”" when both are empty; media errors degrade to showing only people
(and vice versa) — never blank the panel because one side failed.

Keyboard (hand-rolled — there is no `cmdk`/command primitive in the repo):
- Build one flat array of `{ kind: 'media' | 'user' | 'all', to, params }` in render order; keep a
  highlighted index.
- `↓`/`↑` move and wrap; `Home`/`End` optional. Reset index to -1 on every query change.
- `Enter` navigates to the highlighted item, or — when nothing is highlighted — keeps today's
  behaviour: `navigate({ to: '/search', search: { q } })`.
- `Escape` closes the panel first, clears the input on a second press.
- a11y: `role="listbox"` on the panel, `role="option"` + stable `id` per row,
  `aria-activedescendant` / `aria-expanded` / `aria-controls` / `aria-autocomplete="list"` on the
  input, `aria-label` updated from "search titles" to "search titles and people", placeholder to
  `Search titles or people…`.

### 4. Rendering on `/search`

- Delete the `if (onSearchPage) return null` short-circuit and the `onSearchPage` guard on the ⌘K
  listener in `NavSearch`.
- Remove the now-duplicate window `⌘K` listener from `apps/web/src/routes/search.tsx` (keep its
  `autoFocus`), so exactly one component owns the global shortcut and the two don't fight over
  `preventDefault`. The Discover page keeps its own input and kind filter untouched.

## Files

| File | Change |
| --- | --- |
| `apps/web/src/lib/use-debounced.ts` | new — shared debounce hook |
| `apps/web/src/components/layout/NavSearch.tsx` | new — extracted, plus the dropdown |
| `apps/web/src/components/layout/AppNav.tsx` | remove `NavSearch`, import it |
| `apps/web/src/routes/search.tsx` | drop its window ⌘K listener |
| `apps/web/src/components/social/AddFriendDialog.tsx` | use `useDebounced` |

No API, schema, or `packages/` changes — both endpoints and both client hooks are reused as-is.

## Verification

There are **no frontend tests in `apps/web`**, so verification is static checks plus a manual pass.

```sh
pnpm lint && pnpm typecheck && pnpm format:check
pnpm test          # unchanged packages; nothing here should move
```

Manual, against the dev stack (`docker compose -f docker-compose.dev.yml up -d`, then the web app):
1. Sign in, type `star` in the nav search from `/home` → dropdown shows TITLES then PEOPLE.
2. One character shows nothing; two characters trigger exactly one request per endpoint per settle
   (check the network tab for aborted in-flight requests).
3. `↓`/`↑` walk media into people and wrap; Enter on a media row lands on `/media/$slug`, on a
   person on `/users/$username`; Enter with nothing highlighted lands on `/search?q=star` and the
   grid renders from cache without a refetch spinner.
4. Escape closes, second Escape clears; focus never leaves the input while the panel is open.
5. On `/search`, the nav pill is now present and functional alongside the page's own input, and ⌘K
   focuses the nav pill.
6. A query matching only people, and one matching only titles, each render a single section.

Also update `docs/ROADMAP.md` in the same commit (per repo convention) if it tracks the nav search.
