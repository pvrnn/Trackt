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
- `Landing.dc.html`, `Login.dc.html`, `Home.dc.html`, `Search.dc.html`, `Media Detail.dc.html`, `Lists.dc.html`, `Profile.dc.html`
- `support.js` — prototype runtime (needed to open the files; not part of the design)
- `noise.svg` — grain texture asset (IS part of the design)

To view: keep all files in one folder, open any `.dc.html` in a browser. Screens link to each other.
