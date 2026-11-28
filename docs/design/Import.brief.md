# Design brief — Import on Profile, and the match resolver (`/import/matches`)

For the AURA PRISM design session (`Design System.dc.html` is the token source; both pieces should
read as siblings of `Profile.dc.html`, `History.dc.html` and `Onboarding.dc.html`). Deliverables:

1. **An update to `Profile.dc.html`**: an import block on the owner's profile, replacing today's lone
   IMPORT pill.
2. **The import wizard** as a modal over Profile (it exists in code but was never designed).
3. **`Import Matches.dc.html`**, a new hi-fi screen where the viewer settles the titles an import could
   not decide on.

Engineering behind it: `docs/import-sources-plan.md`. This brief carries only what changes the pixels.

## Why this exists

Trackt imports your history from MyAnimeList, AniList, Letterboxd, Trakt, Steam, TV Time and Netflix.
An import never guesses. When it isn't sure which work a row is, it leaves the row unwritten and keeps
it aside. Today those rows sit in the database and nobody can see them: the viewer gets a count and
nothing to act on. A real Netflix history of 239 works left 54 unmatched, 10 of them saved as "could
be one of these". This screen turns them into a short list of decisions the viewer makes in a minute.

## 1. Import on Profile (owner only, never shown to visitors)

Today it is a single IMPORT pill in the right column, next to SEND FEEDBACK. Replace it with a small
glass card in the right column, under **Friends** and above **Trophies**:

- **Nothing imported yet**: an Anton heading ("BRING YOUR HISTORY"), one line of copy, a row of
  source logo tiles (brand colour tiles, 24×24 marks: TV Time, Netflix, Letterboxd, MyAnimeList,
  AniList, Steam, Trakt) and one secondary pill, IMPORT.
- **After imports**: one row per source last imported: logo tile, source name, the profile or file
  label (`regelegorila`, `history to 2026-11-26`), when (`2 DAYS AGO`), and a quiet result
  (`185 OF 239 LOGGED`). A run in progress shows a thin PRISM progress bar and `MATCHING TITLES…`
  or `WRITING 120 / 239`. A failed run shows its reason in one line, with RETRY.
- **When matches wait for an answer**: the card's loudest line, a pink-tinted row
  (`rgba(217,107,176,0.12)`, pink border) reading `10 TITLES NEED YOU` with `RESOLVE →`, linking to
  the matches page. This is the only call to action in the card; IMPORT drops to a ghost link.

Also show the same "N titles need you" nudge as one slim row on **Home** for the owner. This is optional.
Design it if it fits the UP NEXT rail without competing.

## 2. The import wizard (modal over Profile)

Three steps in one modal, with a ✕ way out at every step and nothing written before the last one:

1. **Where from?** A 2-column grid of source cards: logo tile, name, kinds it covers as kind dots +
   labels (`MOVIE · SERIES · ANIME`). A source the instance can't run is dimmed, with its reason in
   faint text (e.g. "STEAM_API_KEY is not set on this instance"). Picking a card opens its input
   below the grid:
   - **Profile sources** (MAL, AniList, Letterboxd, Trakt, Steam): one USERNAME field, with a
     placeholder showing where the name sits in the URL (`letterboxd.com/username`).
   - **File sources** (TV Time, Netflix): a file drop zone and CHOOSE FILE pill, plus **numbered
     how-to steps** with a link. Netflix: ① Open **netflix.com/settings/viewed** (link, opens a new
     tab) ② Click **Download all** at the bottom of the list ③ Drop `NetflixViewingHistory.csv` here.
     TV Time: the two JSON files or the HTML summary from the TV Time Out tool.
     Show the chosen file name with a ✕ to clear it.
   One primary PRISM pill: PREVIEW.
2. **Preview.** While it reads (this can take one to two minutes for a large history, since each title is
   looked up in the catalog), show a calm working state rather than an empty one: an indeterminate
   PRISM bar and `READING YOUR NETFLIX HISTORY. NOTHING HAS BEEN WRITTEN YET.` Then the result as
   one stat strip (Anton numbers): ENTRIES · IN THE CATALOG · ALREADY LOGGED · WOULD BE WRITTEN ·
   NEED YOU. Below, a collapsible "Not in the catalog" list (title rows, first 20, `… 34 MORE`).
   Primary: IMPORT NOW.
3. **Writing / done.** Progress `120 / 239` on a PRISM bar, with "You can close this, the import
   carries on." Done: CREATED · MERGED · ALREADY LOGGED · RATINGS, and if any matches wait,
   the pink `10 TITLES NEED YOU · RESOLVE →` row as the way forward.

## 3. Import matches (`/import/matches`), the new page

Nav as everywhere (HOME / DISCOVER / NEWS / HISTORY / PROFILE). Anton title **NEEDS YOU**, with the
gradient scope label `10 TITLES FROM NETFLIX` (or from several sources).

### The data each row carries

- the source (logo tile) and the **title as the source wrote it**, which is often in another
  language (`Instinct de survie`, `L'immortel`)
- kind (dot + label), season when it's a series (`SEASON 1`), the source's year if it has one
  (Netflix never does)
- what the import would log: status (`COMPLETED`, `IN PROGRESS · 4 EPISODES`) and dates
  (`22 DEC 24`, `05 JUN → 02 JUL 19`)
- **why it's here**, one of two:
  - **TIE**: several works answer to exactly that name (`Shaft` ×3, `The Witcher` 2019 vs 2002)
  - **CLOSE**: the best candidate scored 50–80%, close but not sure
- **2–5 candidates**, best first: cover (generated gradient rule), title, year, kind, and a match
  score (`100%`, `74%`). For a TIE the scores are equal, so **year and cover must do the telling
  apart**: make them prominent.

### What the viewer can do per row

- **Pick a candidate**: the whole candidate tile is the target. Picking writes the log entry at once
  (no separate save), and the row collapses to a one-line confirmation
  (`✓ Shaft (2019) · LOGGED`, with UNDO for a few seconds).
- **Search instead**: "None of these" opens an inline search field that searches the catalog, for
  when the right work isn't among the candidates.
- **Skip**: dismiss the row; it won't come back on the next import.

### Layout

One column of row cards (max ~880px), not a grid: each card is the source row on the left and its
candidates as a horizontal strip of 2:3 covers on the right (wrapping under on narrow widths). A
filter console only if there are 20+ rows: SOURCE and KIND cells, per the system's filter console.
Counts update as rows resolve; the header number counts down.

### States

- **All settled**: a dashed glass empty state, Anton `ALL SETTLED`, "Every title from your imports
  found its place." and `OPEN HISTORY →`.
- **Long list** (100+ rows): the same page, paginated like News.
- **A candidate already in your log**: badge it `IN YOUR LOG`; picking it merges rather than
  duplicates.

## Mobile

Give the matches page a mobile frame too (`Mobile App.dc.html` conventions): one row per screen width,
candidates as a horizontal swipe strip, pick by tap. The profile import card stacks under Friends.

## Tone and copy

Plain and short. The viewer is doing us a favour: thank them by being quick. Never "error" or
"failed" for a match: these rows aren't failures, they're questions. English and French copy both
fit (French runs ~20% longer; check the pink nudge row and the stat labels).
