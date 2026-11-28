# Handoff: Trackt — AURA PRISM Design System & Core Screens

## Overview
Full visual design for **Trackt**, an open-source, self-hostable media tracker (movies, series, anime, manga, webtoons) with per-episode/per-chapter check-ins, ratings, lists, and social activity. This package contains the design system plus 7 hi-fi screens in the **AURA PRISM** direction: near-black base washed with diffuse violet/pink/gold radial "aura" glows under a film of grain, glassy panels, pill-shaped actions, condensed uppercase display type.

## About the Design Files
The `.dc.html` files in this bundle are **design references created in HTML** — interactive prototypes showing intended look and behavior, NOT production code to copy directly. Your task is to **recreate these designs in the target codebase's existing environment** (the Trackt repo: React + TanStack Router + Tailwind, `apps/web`) using its established patterns and libraries. The HTML files open in a browser (keep `support.js` and `noise.svg` alongside them) and can be inspected for exact values.

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii, and interactions are final. Recreate pixel-perfectly using the codebase's component patterns. All media covers are procedurally generated gradients (no real artwork was available); the cover-generation rule below is part of the design.

## Design Tokens

### Colors
- Ink (page bg): `#0E0C10`
- Text primary: `#F0EDF4`
- Text muted: `#B8B1C4`
- Text dim (labels/meta): `#948DA1`
- Text disabled/faint: `#6A6478`
- Glass surface: `rgba(255,255,255,0.05)` (inputs/wells: `0.06`–`0.07`)
- Glass border: `rgba(255,255,255,0.10)` (stronger: `0.12`–`0.15`; divider: `0.09`)
- Accent pink: `#D96BB0` (links, active states, selected chips, watched checkmarks)
- **PRISM gradient**: `linear-gradient(90deg, #D9A441, #D96BB0, #8B5CF6)` — reserved for the ONE primary action per view, the wordmark, and hero stats. Text on it: `#14101A`.
- Selected chip fill: `rgba(217,107,176,0.18)`; "next episode" row fill: `rgba(217,107,176,0.12)` with border `rgba(217,107,176,0.5)`
- Kind dots: movie `#8B5CF6`, series `#4A6EE8`, anime `#D9A441`, manga `#E8874A`, webtoon `#D96BB0`, game `#3FBF8F`

### Background recipe (every page)
Two fixed full-viewport layers behind all content, `pointer-events: none`:
1. **Aura**: 3–4 large radial-gradients — violet `rgba(139,92,246,0.35)` top-left, pink `rgba(217,107,176,0.28)` right, gold `rgba(217,164,65,0.30)` bottom — each fading to transparent by 65–70%. Up to 0.55 opacity on marketing/login panels.
2. **Grain**: `noise.svg` (fractal turbulence, desaturated) tiled at `220px`, `opacity: 0.5`, `mix-blend-mode: overlay`. Grain sits between background and content, never on top of text containers.

### Typography
- Display: **Anton**, uppercase, line-height 0.95–1. Hero 120px (landing), page title 64px, section 32px, card-list title 22–24px
- Body/UI: **Archivo** — body 14–15px/1.5–1.6, card titles 700/16px
- Data/labels: **Space Grotesk** 600, 11–13px, letter-spacing 0.08–0.1em, uppercase
- Gradient text (PRISM clip) only on key display words and hero stats

### Spacing & shape
- Page container: max-width 1360px (design-system doc: 1200px), padding 40px sides
- Card padding 16–24px; grid gaps 16px (covers), 8–10px (row stacks)
- Radii: pills/buttons/inputs `999px`, cards `14–16px`, covers `10–12px`, small thumbs `6px`
- Glass cards use `backdrop-filter: blur(16px)`
- Cover aspect ratio: `2/3`

### Buttons
- Primary: PRISM gradient pill, `#14101A` 700 13px text, letter-spacing 0.06em, padding 12px 24px, hover `filter: brightness(1.15)`
- Secondary: glass pill with `rgba(255,255,255,0.15)` border; hover: border + text turn pink
- Ghost: text-only, hover pink
- Chips (status): Space Grotesk 600 12px pills; selected = pink text/border on `rgba(217,107,176,0.18)`. Pills are for actions and status only; nothing that narrows a list is a pill.

### Filter console (Discover, News, History)
Everything that narrows a list lives in one glass bar (`.fbar`) of equal-height cells (`.fcell`, min-height 54px, padding 0 20px, hairline `rgba(255,255,255,0.09)` dividers, hover/focus tint `rgba(255,255,255,0.045)`). The cells wrap to two rows, then stack, as the page narrows. A cell is a Space Grotesk 10px/700 label (KIND, YEAR, SORT, SHOW, WHEN, STATUS…) followed by a native `<select>` with a CSS chevron; the focused select gets a 2px pink inset ring.

**Kind strip.** The KIND cell is a strip of seven buttons: ALL, always spelled out, then one colour dot per kind. The picked kind (or the one under the pointer) opens into its name and count; the others stay dots, at 0.4 opacity when their count is zero. A picked kind gets its own colour as a tint and ring. Picking the open one again goes back to ALL. Every chip has `aria-pressed` and an `aria-label` of "NAME · count". The other filters narrow first, so the counts stay honest.

### Language menu (every web nav)
A quiet menu control between the search pill and the avatar, not a badge: a globe icon, a borderless `<select aria-label="Language">` (EN / FR / ES / DE …) in Space Grotesk 12px, and a caret. It is 36px tall with an 8px radius and turns `rgba(255,255,255,0.08)` on hover or focus.

### Generated covers
Two-stop `linear-gradient(160deg, <kind-hue> 0%, <near-black> 100%)` seeded by media kind (violet-blues for series/movies, golds for anime/manga, magentas for webtoons), title in Anton bottom-left `rgba(255,255,255,0.94)`, PRISM progress bar (4px) along the bottom edge showing completion. Real artwork replaces the gradient; title/progress treatment stays.

### News (`News.dc.html`)
Masonry news feed for new seasons, adaptations, announcements, release dates, castings and finales. Page title + gradient "N UPDATES FROM YOUR LIBRARY" label. Under it, the filter console (see Filter console): the KIND strip, SHOW (Everything / My library) and WHEN (Any time / Today / This week / This month / Custom). Custom adds a second bar with FROM and TO date cells and CLEAR RANGE. Date and SHOW narrow first, so the kind counts stay honest.

**From your library first.** Stories about titles the user tracks get their own section at the top, "From your library", with a count, instead of a louder card in the feed. The rest follows under "Latest" with the active range as its label.

Feed is a 4-column masonry, packed shortest-column-first in JS (NOT css `column-count`) so recency still reads left-to-right and column bottoms level out; card height is estimated from cover size + text length. Covers come in S/M/L heights (130/180/240px; library stories 200px), plus text-only cards with no cover for rhythm. **The artwork stays clean**: no headline on the cover, and anything that does sit on it (the countdown pill, "IN 62 DAYS") gets an opaque backing. Under the art: the news-type tag, a kind dot, kind · date, the headline (linked), the body, then a ＋ PLAN TO WATCH / READ / PLAY toggle (→ ✓ PLANNED, pink tint and ring) and DETAILS →.

Numbered pagination under Latest (← PREV / 1 2 / NEXT →, 12 stories a page, active page pink, disabled arrows dimmed). Empty state: dashed glass card with an Anton "NOTHING HERE", kind- or date-aware copy, and a BROWSE DISCOVER link. Paginator hides when there is only one page.

### History (`History.dc.html`)
Built from `docs/design/History.brief.md`. Nav: HOME / DISCOVER / NEWS / HISTORY / PROFILE, with the ⌘K search pill, EN and the avatar.

**Two views of one history.** Next to the Anton title and the gradient scope label, a segmented TIMELINE / GRID toggle. Both views share the same filters.

**Filter console** (see Filter console above). Cells: the KIND strip, YEAR (years with data, then ALL TIME), STATUS (All / Completed / In progress / Paused / Dropped), and GROUP BY (Month / Year), which only shows in grid view. Under a hairline, the four stats for the current scope sit in one quiet row inside the console: an Anton gradient number with its label beside it.

**Timeline** (`Timeline.dc.html`, a shared component). One arrow of time you scroll sideways, shared by every kind; colour says which kind. Month rules and labels run along the top. The shaft is one gradient per calendar year (gold in January, violet by December, then it starts again). Each title gets a label that stays in view while its bar scrolls past. The bar is a dashed thread from start to finish, with solid blocks on the days actually logged. Full-size header: a kind legend, zoom − / + (YEARS / MONTHS / WEEKS), ‹ › to move through time, and TODAY →. Kind and status filter it; the year select scrolls it. `mini="true"` drops the header for the Profile embed and puts the stepping controls in the corner, clear of the arrow.

**Grid.** Entries sort by "filed" date (finish date, else start date), newest first, and group under Anton month (or year) headings with a hairline. A `repeat(auto-fill, minmax(168px, 1fr))` grid of 2:3 posters. The artwork stays clean except for a score pill top-right. The record sits underneath, so no hover is needed to read it: title (2-line clamp), kind dot + label · status in its colour, and the date range (`04 JAN → 11 FEB`, a single day for movies, `FROM 12 JUL` when unfinished). On hover the poster lifts 4px with a pink-tinted shadow (off under `prefers-reduced-motion`).

LOAD MORE pill. The empty states are all live and different: filtered out (offers CLEAR KIND & STATUS), nothing in the chosen year, and a brand-new account (BROWSE DISCOVER link). Tweaks: `emptyAccount` and `loading` (the rows drop in opacity with a pink "LOADING 2025…" marker).

**Companion on Media Detail** — the action row gained a dates control: `＋ DATES` when unset, otherwise the range (`12 JUL → …`). It opens a modal with STARTED / FINISHED native date inputs (`color-scheme: dark`), SAVE / CLEAR / CANCEL. The modal copy switches to "We filled these in" when dates were auto-guessed from a completion.

## Screens

### Landing (`Landing.dc.html`)
Marketing page. Nav (gradient wordmark, NEWS / API / GITHUB ↗, EN, SIGN IN pill). Hero split: on the left, kind chips, "TRACK EVERY WEBTOON." (the last word rotates through the kinds), sub-copy, START TRACKING — FREE + VIEW ON GITHUB, and the line "OPEN SOURCE · FULL EXPORT ANY TIME · IMPORT FROM 5 APPS". On the right, a tilted wall of three cover columns drifting past (decoration only), with two app moments floating over it on opaque backing (a check-in toast, a friend's rating). Then: "Six kinds. One log." (how each kind is tracked), "More than a checklist" (four live pieces: check-in demo, spoiler-blurred friends feed, filtered news, profile time split), "Bring your history with you" (import sources with logo slots), a Discord bot section (a mock #watch-party channel: a watch-party post you can join, then the check-ins it produced), the open-source section, and a closer.

### Login (`Login.dc.html`)
Split screen. Left: the form and nothing competing with it. One form with SIGN IN / CREATE ACCOUNT underline tabs (create account adds USERNAME), EMAIL, PASSWORD with a SHOW/HIDE toggle and FORGOT? in sign-in mode, a gradient submit pill, and a link to switch modes. Footer: GitHub link + "TV TIME IMPORT COMING SOON". Right (`aria-hidden`): the same tilted, drifting cover wall as Landing, under a scrim, with a bottom-anchored Anton pitch ("Pick up where / you left off." or "Everything you watch, / read and play.") and the six kind dots. The wall stops under `prefers-reduced-motion`. Create account continues to Onboarding.

### Onboarding (`Onboarding.dc.html`)
A layer over the real Home page (imported with no friends yet), not a separate route. It has a three-step stepper with a ✕ way out at every step. 1, **Bring your history**: import cards for TV Time, Letterboxd, MyAnimeList, AniList and a Steam profile, each with a logo slot, the kinds it covers, and CONNECT → ✓ CONNECTED. 2, **Find your people**: search and invite, plus suggested people with a reason and a follow button, and an empty state. 3, **You are set**: a summary of what came across. Footer: ← BACK on the left, then SKIP THIS STEP and the one way forward on the right (ending in ADD A TITLE / GO TO MY HOME →).

### Home (`Home.dc.html`)
Sticky glass nav: HOME / DISCOVER / NEWS / HISTORY / PROFILE, the ⌘K search pill, EN, and the avatar. "UP NEXT" is now a slim rail: one-tap ✓ check-in per item, a queue label, and ALL 12 IN PROGRESS →. Below it, two columns side by side. **News** ("FROM WHAT YOU TRACK"): a lead story with TRACKING and type tags, then briefs as rows, not cards. **Friends**: activity rows (verb, title, unit, score, quotes, spoiler-blurred text "SPOILER · HOVER TO READ", plan-to-watch action), with an empty state for a fresh instance ("Quiet in here", ＋ FIND FRIENDS / invite).

### Discover (`Search.dc.html`)
"DISCOVER" title, then one search console on a single row (see Filter console): the query cell (⌕, "Search titles, studios, authors…", pink ring on focus), KIND, YEAR (Any / 2026 / 2025 / 2024 / Earlier) and FILTERS. KIND follows the same grammar as every cell: the label, a fixed 100px value naming the pick and its count ("ALL KINDS 124"), then the picker, a hollow ring for All and one dot per kind. Hovering or focusing a dot previews it, dimmer, in the value, so nothing resizes. Picking the picked dot again goes back to All. FILTERS is label, value ("STATUS · GENRES", or "2 ACTIVE" in pink) and chevron, and opens a 440px panel hung off the bar's right edge: STATUS (PICK ONE: Any / Releasing / Finished / Upcoming / On hiatus / Cancelled), GENRES (PICK ANY, or "N SELECTED · MATCH ALL": a search box over check chips), each option with the count it would give, then RESET and "SHOW N TITLES". Escape or a click outside closes it. Whatever the panel sets shows as removable tokens under the bar (`STATUS FINISHED ×`, `GENRE DRAMA ×`, CLEAR). The bar wraps to two rows, then a stack; once wrapped the KIND, YEAR and FILTERS cells grow to share a row, and at phone width the KIND value goes and the dots stay. SORT (Trending / Newest / A–Z) orders rather than narrows, so it sits beside the result count as a quiet menu. A 6-column poster grid where the artwork stays clean: an optional tracked pill (IN PROGRESS / COMPLETED) top-left, and the title, kind dot · year, and a span badge ("2 SEASONS", "12 VOL", or "S2" when the entry is one season) sit below the poster. Empty state "Nothing matches" with RESET FILTERS. The bottom "Can't find it?" card is unchanged.

### Media Detail (`Media Detail.dc.html`)
Hero: full-bleed banner with a scrim on the reading side only, so artwork from any source keeps contrast; kind · year · genres on one line; Anton title; synopsis; "AIRING · 2 SEASONS · 22 EPISODES". Three controls, in the order you use them: the next-step CTA, a status dropdown, and favourite. A facts strip (not a table) with ALSO ON TMDB ↗ / TVMAZE ↗, TMDB attribution, and a report link. Left: Episodes, with season chips, mark-all, the unified progress control shared with mobile (editable number, − / + steppers, slider, percent), and episode rows. Right: a **Your log** card with one row each for rating (drag or click the meter, half points, CLEAR), dates (opens the date-editor modal), and review (✎ WRITE); then Related.

### Lists (`Lists.dc.html`)
"LISTS" + gradient NEW LIST pill. Tabs: MY LISTS / FOLLOWING / COLLABORATIVE. 2-col grid of list cards: 4 fanned cover panels (170px), Anton title, RANKED/COLLAB pill badges, description, meta row (count/visibility/updated); hover = pink border. Below: opened ranked list — rows with gradient Anton rank numbers, 44×62 thumb, title/meta, pink score, drag handle ⋮⋮.

### Profile (`Profile.dc.html`)
Identity in one line of sight: avatar, name, bio, @handle, join date, friends, streak, and EDIT PROFILE / add-friend / share. Numbers sit in one quiet strip, not five cards. Left column: **Favourites** stay one row (Top picks = the #1 of every kind; kind tabs go deeper; ✎ EDIT & REORDER; a ＋ slot), then **Right now** (in-progress titles), then **Timeline** (the History timeline in mini form, OPEN IN HISTORY →), then **Recent** as rows (FULL HISTORY →). Right column: a visitor-only "YOU AND MARA" card for titles in common; **Taste** (where the time goes by kind %, the genres they keep coming back to, average rating); **Friends** (＋ ADD FRIEND, requests waiting); **Trophies** (three crystals from the cabinet, points, rank among friends, ALL →); and profile visibility.

**Imports** (owner only, never shown to visitors): a glass card in the right column under Friends. Before any import it invites (BRING YOUR HISTORY, source tiles, IMPORT); after, one row per source with its label, when, and `185 OF 239 LOGGED`, a thin PRISM bar and `MATCHING TITLES…` / `WRITING 120 / 239` while a run goes, and a failure's reason with RETRY. When titles wait, the card's one loud line is a pink-tinted `10 TITLES NEED YOU · RESOLVE →` row, and IMPORT drops to a ghost `＋ IMPORT ANOTHER`. Source tiles are the brand colour with a dashed slot where the official mark goes; the build uses the real marks.

### Import wizard (`Import.dc.html`)
A modal over Profile in three steps (WHERE FROM / PREVIEW / IMPORT), ✕ at every step and nothing written before the last. **Where from?** is a 2-column grid of source cards (tile, name, kind dots); one the instance can't run is dimmed with its reason. Picking a card opens its input under the grid: USERNAME for profile sources; for file sources a drop zone with CHOOSE FILE and numbered HOW TO GET THE FILE steps (Netflix: open netflix.com/settings/viewed ↗, click Download all, drop NetflixViewingHistory.csv). **Preview** reads with an indeterminate PRISM bar and "Each title is looked up in the catalog, so a large history takes a minute or two", then one Anton stat strip (ENTRIES · IN THE CATALOG · ALREADY LOGGED · WOULD BE WRITTEN · NEED YOU) and a "Not in the catalog" list. **Import** writes on a PRISM bar ("You can close this, the import carries on."), then CREATED · MERGED · ALREADY LOGGED · RATINGS, with the NEED YOU row as the way forward. States: source, reading, preview, writing, done; EN and FR.

### Import matches (`Import Matches.dc.html`)
`/import/matches`, titled **Needs you**: the titles an import couldn't decide on, as questions, never as failures. One column of row cards. Left: the source tile, the title AS NETFLIX WROTE IT, kind (and season), what it WOULD LOG, and why it's here: `TIE · 3 WORKS SHARE THIS NAME` or `CLOSE · BEST IS 74%`. Right: the candidates as 2:3 covers with year and score up front (in a tie the scores are equal, so year and cover tell them apart); one already logged is badged IN YOUR LOG and merges. Picking a cover logs it at once and folds the row to `✓ Shaft (2019) · LOGGED` with UNDO. NONE OF THESE opens an inline catalog search; SKIP dismisses it. SOURCE and KIND filter cells appear only for long lists, which paginate like News; the header count goes down as rows settle. Empty state: dashed glass card, Anton ALL SETTLED, OPEN HISTORY →. States: netflix, several sources, long, settled; EN and FR. `Mobile App.dc.html` carries the phone version (one row per screen, candidates as a swipe strip).

### Trophies (`Trophies.dc.html`, `Mobile Trophies.dc.html`)
Three 3D ideas. **Crystal prisms**: every trophy is a hexagonal prism, taller and rarer by tier (bronze, silver, gold, prism); locked ones are empty glass that fills from the bottom as you progress. **A medal you can spin**: the spotlight (web) or detail screen (mobile) shows the picked trophy as a medal with a milled edge and an engraved back; drag sideways to turn it. **A podium that rises**: the leaderboard's top three stand on real blocks that rise again when you switch Global / Friends or the period, with a chase card naming the points to pass the next friend. Web: summary strip, spotlight, Recently unlocked and Next up shelves, sticky leaderboard. Mobile: cabinet, trophy detail (with "How you got it"), and leaderboard, pushed from Profile.

## Interactions & Behavior
- Check-in buttons toggle checked state (label + background change); production: optimistic mutation
- Episode circle toggles watched; "next episode" highlight recomputes to first unwatched, non-future episode
- Search input filters results live; the kind strip, year and sort combine with it; kind counts reflect the text + year scope
- Spoiler text: `filter: blur(5px)`, removed on hover (production: click-to-reveal is safer on touch)
- Hovers: primary = brightness 1.15; secondary/cards = pink border/text; links → pink
- Nav is sticky with backdrop blur
- No page transition animations designed yet

## State Management (suggested)
- `upNext[]` queue with per-item checked state
- `watched: Set<episodeId>` per series; derived `nextEpisode`
- Search: `query` + `kindFilter` + `year` + `sort` + `status` + `genres` (+ `genreQuery`, `panel`)
- Covers: deterministic gradient seeded from kind + title hash

## Assets
- `noise.svg` — grain tile (SVG fractal turbulence). Only binary-ish asset; everything else is CSS.
- Fonts: Anton, Archivo, Space Grotesk (Google Fonts, weights 400–700)
- All titles/users/stats are fictional placeholder content

## Files
- `Design System.dc.html` — token reference + component gallery (start here)
- `Landing.dc.html`, `Login.dc.html`, `Onboarding.dc.html`, `Home.dc.html`, `Search.dc.html`, `News.dc.html`, `History.dc.html`, `Media Detail.dc.html`, `Lists.dc.html`, `Profile.dc.html`, `Import.dc.html`, `Import Matches.dc.html`, `Trophies.dc.html`, `Mobile Trophies.dc.html`
- `Timeline.dc.html` — shared timeline component, imported by History (full) and Profile (mini)
- `support.js` — prototype runtime (needed to open the files; not part of the design)
- `noise.svg` — grain texture asset (IS part of the design)

To view: keep all files in one folder, open any `.dc.html` in a browser. Screens link to each other.

---

## Mobile app (native, iOS + Android)

Two files: `Mobile System.dc.html` (the native spec) and `Mobile App.dc.html` (8 screens in device frames). Requires `ios-frame.jsx` and `android-frame.jsx`, both included. Dark only — no light theme.

The brand layer is unchanged from web: same ink (#0E0C10), same prism gradient (#D9A441 → #D96BB0 → #8B5CF6), same Anton / Archivo / Space Grotesk, same fixed aura + grain layers. Only the mechanics are native.

### Canvas
402pt design width (iPhone 16/17) · 412dp Android. Content column 362pt with 20pt gutters, never less. Top inset 62pt (status + notch). Tab bar 64pt + 34pt home indicator = 98pt reserved. 28pt between sections, 12pt within. Minimum touch target 44 × 44pt, no exceptions. Radii: cards 12 · sheets 22 (top only) · pills 999. Aura and grain are fixed to the viewport, not the scroll container — one paint, no scroll-linked repaint.

### Type at 402pt
Page title Anton 34 / line-height 1.15 / uppercase (down from 64–120 on web; a full-bleed Anton line has to fit 362pt without hyphenating). Section Anton 22. Card title Archivo 700 / 15. Body Archivo 400 / 14 / 1.55. Meta Space Grotesk 600 / 11 / +0.08em. Tab label Space Grotesk 600 / 10. Stat Anton 26 in the prism gradient. Nothing functional below 11px.

### Four-tab spine
HOME · DISCOVER · NEWS · PROFILE. Four, not six: four 90pt targets clear 44pt with room for a mis-tap; a fifth would squeeze labels below 10px. **Lists and History are destinations inside Profile**, two rows directly under the stat band — both are weekly, not daily. Tab bar is glass over the aura (82% ink, 20px blur, hairline top). Active state = pink glyph + label + an 18×2 rule beneath; no filled pill, the aura already carries the colour. No center FAB — check-in is a swipe on the row you are already looking at.

### Swipe to check in (the core interaction)
Drag an up-next row right. Thresholds: **0–32pt inert** (the gesture may still resolve as a scroll, so the prism track only ghosts in at 0.25–0.45 opacity) → **32pt** track appears → **96pt armed**, label flips to RELEASE TO CHECK IN and a selection tick fires → release commits. Under 96pt the row springs back over 180ms. On commit the row exits right over 220ms, the list closes the gap, and an undo toast sits 12pt above the tab bar for 5s with a single UNDO action. Never a confirmation dialog — commit instantly, offer undo; the cost of a wrong check-in is one tap. Left swipe reveals SKIP EPISODE and ADD TO LIST on a #12101A track; nothing is ever deleted by a gesture. Rows are 72pt tall with a 40×56 cover thumb; at rest the only affordance is a dim chevron. This is implemented live in `Mobile App.dc.html` on the iOS Home screen (pointer events, real thresholds), with a `swipeHint` tweak that ghosts the track in at rest.

### Sheets and pull to refresh
Sheet surface is #191520 **solid, not glass** — content behind must never fight the text. 22pt top radius, square bottom. Grabber 36 × 4pt at rgba(255,255,255,0.25) with 10pt top padding. Backdrop rgba(8,6,12,0.72) + 6px blur, tap to dismiss. Detents 42% (rate, quick actions) and 92% (episode pickers). Used for: rating, episode picker, list add, status change, filters. Pull to refresh: prism conic arc, armed at 64pt of pull.

### Motion and haptics
140ms micro (press, chip selection) · 220ms commit (check-in exit, sheet present/dismiss, toast in) · 320ms navigate (push/pop) · 180ms spring-back (abandoned swipe). Haptics only for state changes the user caused and cannot see confirmed elsewhere: check-in commit (medium impact), crossing the swipe threshold (selection tick), failed sync (error notification). Never on scroll, never on tab change.

### iOS vs Android
Identical brand layer; only chrome and physics diverge. Header: iOS large Anton title in the scroll flow collapsing to a 44pt glass bar / Android Anton title in a Material large top app bar collapsing to a small one. Bottom: iOS tab bar 64pt glass / Android navigation bar 80dp with an active indicator pill. Back: iOS left-edge swipe + header chevron / Android system back gesture, no in-app chevron. Sheets: iOS detented with rubber-band overscroll / Android Material bottom sheet, same surface and radius, no rubber-band. Touch feedback: iOS opacity dip to 0.7 / Android pink ripple at 12% from the touch point. System font (SF / Roboto) appears only in the status bar and keyboard. Toast: iOS custom pill / Android snackbar geometry with our pill styling.

### Screens in `Mobile App.dc.html`
Home (iOS, swipe live) · Home (Android, showing the nav-bar divergence) · Media Detail with the rating sheet open · Discover · News (single column — masonry does not survive 362pt) · History (2-up poster cards) · Lists · Profile · a home-screen mock with a medium UP NEXT widget, two small widgets (STREAK, S3 PREMIERE countdown) and a notification banner. Widgets sit on a translucent plate carrying the aura so they read on any wallpaper. **Notifications never spoil: episode titles only, never plot text.**

### Layout note for implementers
Inside a fixed-height device screen, every section child of the scrolling column needs `flex-shrink: 0` and the column needs `min-height: 0`. Without it the browser proportionally compresses children when content exceeds the viewport, which silently collapses chip rows to zero height and crushes `aspect-ratio` covers.
