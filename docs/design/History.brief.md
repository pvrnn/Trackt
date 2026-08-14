# Design brief — History (`/history`)

For the AURA PRISM design session (`Design System.dc.html` is the token source; this screen should
read as a sibling of `Profile.dc.html` and `Search.dc.html`). Deliverable: **`History.dc.html`**, one
more hi-fi screen in the existing bundle, linked from the app nav like the others.

Engineering plan behind it: [`docs/history-plan.md`](../history-plan.md). This brief carries only what
changes the pixels.

## What the page is

The viewer's own record of **what they watched, and when**. "Show me 2025" — the titles they finished
that year, the ones they were working through, filterable down to a season or a media kind. It is the
answer to the thing people actually miss when a tracker shuts down: not the ratings, the memory.

It also absorbs what the roadmap called the Library page — with the year filter set to ALL TIME it is
the viewer's whole collection, so it has to survive being long. A heavy user has a few hundred rows
in a year and thousands overall.

New sixth item in the app nav, between LISTS and PROFILE: **HISTORY**.

## The data it renders

Every row is one tracked title, with:

- cover (generated gradient per the system's rule), kind, title
- **status** — completed / in progress / paused / dropped (never "planned" — a watchlist entry has no
  viewing date and never appears here)
- **a date range**, not a date: `04 JAN → 11 FEB`. Sometimes only a start (`FROM 04 JAN`, still going),
  sometimes start and finish on the same day (a film watched in one sitting)
- the viewer's score, if they rated it — 0–10, half points, often absent
- progress as `8 / 12` episodes or chapters — absent for films, and absent when the catalog doesn't
  know the total

Rows are ordered newest-first by the date the title is filed under (its finish date, or its start date
if it isn't finished), and **grouped under month headings** — `JANUARY`, `FEBRUARY`. A month with
nothing in it is simply absent.

## Filters (all live in the URL, all combine)

1. **Year** — the primary control, and the page's whole premise. A row of chips: `2026` `2025` `2024`
   … `ALL TIME`, built from the years the viewer actually has data in (so a new account sees one chip,
   and nobody sees an empty 2019). Defaults to the current year.
2. **Season** — appears only when a year is selected: `WINTER` `SPRING` `SUMMER` `AUTUMN`. These are
   anime quarters (Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec), so a season never straddles two years.
3. **Kind** — `ALL / MOVIES / SERIES / ANIME / MANGA / WEBTOONS`, the same control as Discover.
4. **Status** — completed / in progress / paused / dropped, defaulting to everything.

Four filter rows stacked would eat the fold. Worth solving in the design: which of these are chips,
which collapse into a dropdown, and how the season row appears without the layout jumping when a year
chip is picked. Discover stacks two rows (`Search.dc.html`); News stacks three and is already dense
(`News.dc.html`) — this is one more than either, and it's the interesting layout problem here.

## Stats strip

Under the filters, reflecting the current filter — so it recomputes as you move between years:

| Figure               | Reads from                                     |
| -------------------- | ---------------------------------------------- |
| **TITLES COMPLETED** | titles finished in the window                  |
| **TITLES STARTED**   | titles begun in the window                     |
| **EPISODES**         | individual check-ins during the window         |
| **CHAPTERS**         | individual check-ins during the window         |

Gradient Anton numbers over Space Grotesk labels, exactly the `Profile.dc.html` stat cards — four of
them, not five.

⚠️ The two halves genuinely disagree and that is not a bug: TITLES COMPLETED counts things you
*finished* in 2025, EPISODES counts episodes you *watched* during 2025 — a show you started in
December 2024 and finished in January 2025 contributes to both years differently. The labels have to
carry that distinction on their own; there is no room for a footnote.

**No "hours watched" / "time spent" card.** It is the one stat everyone expects here and the catalog
holds no runtime to compute it from — designing the slot invites a number we cannot fill. When runtime
data lands, this strip is where it goes.

## States to draw

- **Populated** — the main case, a long year with several months.
- **Empty, nothing tracked at all** — a brand-new account. Should point at Discover.
- **Empty, this year** — they have history, just not in 2023. The year chips are the way out and the
  copy should say so.
- **Empty, filtered** — a kind/status combination with no matches. Different problem, different copy:
  the fix is clearing a filter, not changing the year.
- **Loading** — the page keeps the previous year's rows visible while the next loads rather than
  blanking, so this is a subtle busy treatment, not a skeleton screen.
- **Paging** — a `LOAD MORE` button at the end, matching the News feed (the list is keyset-paginated;
  there is no page-numbered pager).

## A companion piece on Media Detail

The plan adds start/finish dates to the log, which means one new control on `Media Detail.dc.html`'s
action row, beside the status chip:

- **`＋ DATES`** when nothing is recorded
- **`04 JAN → 11 FEB`** once it is — a glass pill, tapping it opens an editor

And the editor itself: a small modal with two date fields (start, finish), CLEAR and SAVE. It appears
by itself in exactly one situation — the user marks something completed that they had never logged
before, so the app has guessed "today" for both dates and is asking them to correct it. Worth a
moment's thought on the copy: it should read as "we filled this in, fix it if we're wrong", never as
a form standing between them and the thing they just did.

## Constraints

- **Tokens are final** (`docs/design/README.md`). No new palette entries, no new type sizes. If a row
  needs a new treatment, it should compose from existing chips, pills and glass cards.
- Reuse across screens: filter chips from Discover, stat cards from Profile, date pills from News's
  FROM/TO controls, cover treatment and kind dots from the system doc.
- Page container 1360px, 40px side padding, standard aura + grain background.
- The row list must stay legible at both extremes — a month with two films, and ALL TIME with a
  thousand rows.
