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
- Kind dots: movie `#8B5CF6`, series `#4A6EE8`, anime `#D9A441`, manga `#E8874A`, webtoon `#D96BB0`

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
- Chips (filters/status): Space Grotesk 600 12px pills; selected = pink text/border on `rgba(217,107,176,0.18)`

### Generated covers
Two-stop `linear-gradient(160deg, <kind-hue> 0%, <near-black> 100%)` seeded by media kind (violet-blues for series/movies, golds for anime/manga, magentas for webtoons), title in Anton bottom-left `rgba(255,255,255,0.94)`, PRISM progress bar (4px) along the bottom edge showing completion. Real artwork replaces the gradient; title/progress treatment stays.

### News (`News.dc.html`)
Pinterest-style masonry news feed for new seasons, adaptations, announcements, release dates, castings and finales. Sticky nav has a NEWS item. Page title + gradient "N UPDATES FROM YOUR LIBRARY" label. Media-kind tabs (ALL / SERIES / MOVIES / ANIME / MANGA / WEBTOONS, pink underline on active). Date filter row: TODAY / THIS WEEK / THIS MONTH / ALL TIME chips + a FROM–TO date picker with CLEAR.

Feed is a 4-column masonry, packed shortest-column-first in JS (NOT css `column-count`) so recency still reads left-to-right and column bottoms level out; card height is estimated from cover size + text length. Cards come in S/M/L cover heights (130/180/250px) with matching title sizes, plus text-only cards with no cover for rhythm. Each card: cover with bottom scrim + Anton title, colored news-type tag pill, kind · date meta, headline, body, and a PLAN TO WATCH toggle (→ ✓ PLANNED) plus DETAILS link.

**Library integration** — stories about titles the user tracks are merged into the same feed (ordered first), not a separate section, and highlighted with a 1.5px pink contour ring, faint pink tint, a floating TRACKING pill top-left over the cover, a countdown pill top-right ("IN 62 DAYS"), and the gradient (rather than glass) PLAN TO WATCH button. The two cover pills share one absolutely-positioned flex row with space-between so they can never collide; the TRACKING pill collapses to just its dot when a countdown is present.

Numbered pagination at the bottom (PREV / 1 2 / NEXT, active page pink, disabled arrows dimmed) with an "1–16 OF 19 STORIES" count beside the heading. Empty state: dashed glass card with an Anton "NOTHING YET", kind- or date-aware copy, and a BROWSE DISCOVER link. Paginator hides when there is only one page.

### History (`History.dc.html`)
Built from `docs/design/History.brief.md`. Sixth nav item (LISTS → HISTORY → ACTIVITY), added to every screen.

**Filters — two rows, not four.** Row 1: year chips (years with data, then ALL TIME) and the four season chips share one row, split by a vertical hairline. The season slot is ALWAYS rendered — on ALL TIME it dims to 25% opacity and goes `pointer-events: none` — so changing year never reflows what is below it. Row 2: media-kind underline tabs (ALL / MOVIES / SERIES / ANIME / MANGA / WEBTOONS, News-style pink underline) with a glass STATUS dropdown parked at the right end of the same tab row; the menu lists All / Completed / In progress / Paused / Dropped, each with a live count for the current date+kind scope, and the trigger's ring turns pink when a status is active.

**Stats.** One compact band of four cards: the Anton gradient number sits INLINE beside two stacked label lines (`TITLES COMPLETED` / `FINISHED · SUMMER 2026`), ~62px tall rather than ~130px. The second line is what disambiguates "titles completed" from "episode check-ins" — same scope suffix on all four, always grammatical (`FINISHED · ALL TIME`).

**Entries.** Rows sort by "filed" date (finish date, else start date), newest first, and group under Anton month headings (year appended on ALL TIME). Each entry is ONE self-contained 2:3 poster card in a `repeat(auto-fill, minmax(184px, 1fr))` grid — no caption below the card. Over the artwork sit only two pills on opaque `rgba(14,12,16,0.82)` chips (status left, score right, backed by a short top scrim). At the bottom, a SOLID `#12101A` plate with a hairline top edge carries the Anton title and the media-kind label + dot. On hover the whole card fills with `#12101A` (140ms) to show the full record: title, date range, kind, and progress. Nothing legibility-critical ever sits on raw artwork, so white and black posters read identically. Date range is `04 JAN → 11 FEB`, single day for movies, `FROM 12 JUL` when unfinished; progress is hidden on completed titles (`24 / 24` is noise) and shown for in-progress/paused/dropped.

18 entries per page with a LOAD MORE pill. Empty states are all live and distinct: filtered-out (offers CLEAR KIND & STATUS), no data in the chosen year/season (points at the year chips), and a brand-new account (BROWSE DISCOVER link). Tweaks: `emptyAccount` and `loading` (rows drop to 45% with a pink "LOADING 2025…" marker).

**Companion on Media Detail** — the action row gained a dates control: `＋ DATES` when unset, otherwise the range (`12 JUL → …`). It opens a modal with STARTED / FINISHED native date inputs (`color-scheme: dark`), SAVE / CLEAR / CANCEL. The modal copy switches to "We filled these in" when dates were auto-guessed from a completion.

## Screens

### Landing (`Landing.dc.html`)
Marketing page. Nav (wordmark gradient, SELF-HOST/API/GITHUB links, SIGN IN gradient pill) → hero: eyebrow label, 120px Anton "TRACK EVERYTHING. LOSE NOTHING." (gradient on "nothing."), sub-copy, two CTAs, `docker compose up` code chip → full-bleed cover strip rotated −2° (tweakable −6°…6°), titles top-left → "Why this exists" 4 glass pillar cards → "Two taps" band with a live up-next card demo → footer with GPL-3.0 + TMDB attribution.

### Login (`Login.dc.html`)
Split screen. Left: aura panel at high opacity (violet/pink/gold, 0.45–0.55) + grain, bottom-anchored Anton headline "Every episode. Every chapter. Yours forever." (gradient last line). Right: email/password inputs (glass, radius 12px), gradient SIGN IN pill, "NEW HERE" divider, CREATE ACCOUNT ghost pill, TV Time import promo card.

### Home (`Home.dc.html`)
Sticky glass nav (blur 16, `rgba(14,12,16,0.75)`), active link = pink underline. "UP NEXT" 64px + gradient count label. 3-col grid of up-next cards: 96×136 cover, kind label, title, next-episode line, gradient CHECK IN pill (toggles to "CHECKED IN" on `rgba(255,255,255,0.25)`). "IN PROGRESS" 6-col cover grid with PRISM progress bars. Bottom: Friends activity rows (avatar, text, timestamp) 2/3 + This-year stat cards (gradient Anton numbers) 1/3.

### Discover (`Search.dc.html`)
"DISCOVER" title, large pill search input (⌘K chip, filters as you type), kind filter chips (ALL/MOVIES/SERIES/ANIME/MANGA/WEBTOONS — selected pink). 6-col result grid with kind dot + year captions. Bottom: "Can't find it?" dashed-border glass CTA with gradient CREATE ENTRY pill (community catalog entry creation).

### Media Detail (`Media Detail.dc.html`)
Hero: 240×360 cover, kind dot + meta line, 72px Anton title, synopsis, action row (gradient CHECK IN S2 E5 · IN PROGRESS status chip ▾ · ＋ LIST · RATE), stats (gradient 8.5 rating, 9/22 progress, 42 min). Body 2:1 grid — left: season chips, episode-ratings heat bar (pink-scale bars, unaired dimmed), episode rows: watched = pink filled circle check + pink rating; next = pink-tinted row with outlined circle; unaired = 45% opacity with date. Clicking the circle toggles watched. Right: comments (spoiler = blurred text, unblur on hover, pink SPOILER tag), details key/value card + TMDB attribution, related 3-up covers.

### Lists (`Lists.dc.html`)
"LISTS" + gradient NEW LIST pill. Tabs: MY LISTS / FOLLOWING / COLLABORATIVE. 2-col grid of list cards: 4 fanned cover panels (170px), Anton title, RANKED/COLLAB pill badges, description, meta row (count/visibility/updated); hover = pink border. Below: opened ranked list — rows with gradient Anton rank numbers, 44×62 thumb, title/meta, pink score, drag handle ⋮⋮.

### Profile (`Profile.dc.html`)
Header: 120px round gradient avatar, 56px Anton name, bio, followers/following + pink streak. 5 glass stat cards (gradient Anton numbers). Favourites blocks per kind (ranked covers with pill rank badges 01/02…, dashed ＋ add slot). Bottom 2:1: Recent activity rows (kind dot, verb + title, date) | Badges (round gradient-tinted icon chips) + visibility setting row.

## Interactions & Behavior
- Check-in buttons toggle checked state (label + background change); production: optimistic mutation
- Episode circle toggles watched; "next episode" highlight recomputes to first unwatched, non-future episode
- Search input filters results live; kind chips filter by type; both combine
- Spoiler text: `filter: blur(5px)`, removed on hover (production: click-to-reveal is safer on touch)
- Hovers: primary = brightness 1.15; secondary/cards = pink border/text; links → pink
- Nav is sticky with backdrop blur
- No page transition animations designed yet

## State Management (suggested)
- `upNext[]` queue with per-item checked state
- `watched: Set<episodeId>` per series; derived `nextEpisode`
- Search: `query` + `kindFilter`
- Covers: deterministic gradient seeded from kind + title hash

## Assets
- `noise.svg` — grain tile (SVG fractal turbulence). Only binary-ish asset; everything else is CSS.
- Fonts: Anton, Archivo, Space Grotesk (Google Fonts, weights 400–700)
- All titles/users/stats are fictional placeholder content

## Files
- `Design System.dc.html` — token reference + component gallery (start here)
- `Landing.dc.html`, `Login.dc.html`, `Home.dc.html`, `Search.dc.html`, `News.dc.html`, `History.dc.html`, `Media Detail.dc.html`, `Lists.dc.html`, `Profile.dc.html`
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
