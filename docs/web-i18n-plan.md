# Plan — Web i18n (English + French)

> **Status:** Built — 2026-10-23. English and French are both complete in
> `apps/web`; the switcher is mounted in the signed-in account area and the
> marketing nav. Decisions recorded in
> [ADR-0009](adr/0009-locale-cookie-and-bundled-catalogs.md). Frontend-only:
> mobile and provider-side localization deliberately deferred (§11).

## Context

There is no i18n system anywhere in the repo today. `apps/web` renders English
literals from three places, all of which this change has to touch:

- **Components and routes** — roughly 270 user-facing strings across 48 `.tsx`
  files, from `NAV_ITEMS` (`apps/web/src/components/layout/AppNav.tsx:25`) to
  the auth error copy (`apps/web/src/routes/login.tsx:39`). `aria-label`s and
  `Tooltip` labels are user-facing literals too
  (`AppNav.tsx:107`, `:76`).
- **`packages/client` display helpers** — `KIND_LABELS` / `LOG_STATUS_LABELS`
  (`packages/client/src/kinds.ts:9`, `:31`), `TOPIC_LABELS`
  (`packages/client/src/news.ts:20`), `updatedLabel` / `visibilityLabel`
  (`packages/client/src/lists.ts:121`, `:136`), `activityVerbLabel`
  (`packages/client/src/home.ts:49`), the month tables and `dateRangeLabel`
  (`packages/client/src/history.ts:93`, `:108`, `:139`). `trackingVerbLabel`
  lives in `packages/shared/src/media.ts:72`. Every one of them is imported by
  web *and* by `apps/mobile`.
- **`Intl` defaults baked as `'en-GB'`** — `ProfileHeader.tsx:53`,
  `packages/client/src/news.ts:33`, and seven `toFixed(1)` call sites that render
  `8.5` where French wants `8,5` (`RatingPopover.tsx:66`/`:112`,
  `ProfileHeader.tsx:96`, `history.tsx:384`, `media.$slug.tsx:606`/`:617`,
  `lists_.$id.tsx:250`).

`apps/web/src/routes/__root.tsx:31` hardcodes `<html lang="en">`, and every
route's `head()` hardcodes an English `<title>`.

**Goal:** every chrome string in `apps/web` comes from a catalog; `en` and `fr`
are both complete; the reader picks one and it persists; SSR renders the chosen
language (correct `<html lang>`, no English flash before hydration).

**Out of scope / stays English:** catalog titles and overviews (the provider
metadata is English — a separate, larger change to `packages/providers` and the
catalog), news article bodies, usernames, list names and every other
user-generated string, `/api/v1` error bodies (the UI maps codes instead, §7),
the `docs/design` mockups, and `apps/mobile`.

Expectation to set in the PR description: **v1 translates the chrome, not the
content.** A French reader sees a French app wrapped around English film
synopses and English news.

### Decisions taken

| Question | Decision |
| --- | --- |
| Library | `i18next` + `react-i18next` (see §2 for why not hand-rolled) |
| Locale source of truth | `trackt_locale` cookie, read on the server per request |
| First visit | negotiate `Accept-Language`; anything unmatched is `en` |
| Locale in the URL | **No** — no `/fr/…` segment, no `?lang=` |
| Persistence | cookie only in v1; per-user `user.locale` is a follow-up |
| Catalog location | `apps/web/src/i18n/`, shaped to be lifted to `packages/i18n` for mobile |
| Missing key | typecheck failure (typed keys + shape-checked `fr`), not a runtime fallback |
| Switcher | account menu (signed in) + marketing nav (signed out) — not a nav pill |
| Rollout | the switcher is unmounted until the final PR, so no PR ships a half-French UI |

---

## 1. What an ADR has to record

Short one (`docs/adr/0009-…`), because most of these are contracts:

1. Locale is a **cookie**, not a route segment. Consequence: public pages have
   no per-language URLs, so no `hreflang`; acceptable because the instance is
   self-hosted and most surfaces are behind auth. Adding `/fr` later is
   additive, not a rewrite.
2. **Bundled catalogs**, no HTTP translation backend. Consequence: no Suspense
   boundary or loading state on either side of hydration, and both catalogs ship
   in the client bundle (~10–20 KB each for this string count).
3. `apps/web` first, `packages/i18n` when mobile lands. Until then, the English
   constants in `packages/client` stay for mobile and web stops importing them
   (§6) — the seam is deliberate, and the follow-up removes the duplication.
4. Provider and catalog content is **not** localized. That is a product
   statement, not an oversight.

---

## 2. Library: `i18next` + `react-i18next`

`pnpm --filter @trackt/web add i18next react-i18next` (currently 26.5.7 / 17.1.5;
React 19 and TS 5 are both inside the peer ranges).

Alternatives considered:

- **Hand-rolled `t(key, params)` over a typed `Record`** — about 150 lines, zero
  dependencies, and the most idiomatic fit for a repo that already prefers
  exhaustive `Record<MediaKind, …>`. Rejected because plural categories
  (`Intl.PluralRules` for `fr` has `one`/`many`/`other`), interpolation, and the
  eventual translator hand-off (JSON catalogs, Weblate/Crowdin, `Trans` for
  sentences containing a `<Link>`) are precisely the parts a hand-rolled version
  gets wrong first.
- **`@lingui`** — the best translator workflow (`.po` extraction with a compile
  step), but it adds a Vite/Babel macro plugin to a Vite 8 + TanStack Start SSR
  build. Not worth the build risk for two locales.
- **`react-intl`/ICU** — good, but message-parsing at runtime and a heavier API
  surface than `t()` for no benefit at this size.

**Per-request instance, never the singleton.** i18next's module singleton is a
locale-leak across concurrent SSR requests — the classic failure where one
request's French renders in another's English. `i18next.createInstance()` per
request (on the client: once per app load) is the whole fix, and `getRouter()`
is already per-request (`apps/web/src/router.tsx:7` — the author's comment says
so, and it is where `queryClient` is created).

---

## 3. Catalog layout and typing

```
apps/web/src/i18n/
  index.ts            createI18n, negotiateLocale, LOCALE_COOKIE, Locale, SUPPORTED_LOCALES
  use-locale.ts       useLocale(): reads the instance, writes the cookie, re-runs head()
  i18next.d.ts        module augmentation: keys are checked against the merged `en`
  locales/
    index.ts          exports `en` (base + surface fragments), `fr` shape-checked against it
    en.json           base catalog: common, meta, nav, kind, status, topics, auth, shell, marketing
    fr.json
    fragments/        one en/fr pair per surface (discover, media, home, history, lists,
                      profile, social, news, feedback) so surfaces can be converted independently
```

Group keys by **surface**, not by component — a component that moves shouldn't
move 30 keys:

```json
{
  "meta": { "description": "…" },
  "nav": { "home": "ACCUEIL", "discover": "DÉCOUVRIR", "news": "ACTUS", "lists": "LISTES", "history": "HISTORIQUE", "profile": "PROFIL" },
  "kind": { "movie": "FILMS", "series": "SÉRIES", "anime": "ANIMÉ", "manga": "MANGA", "webtoon": "WEBTOONS" },
  "list": { "friends_one": "{{count}} ami", "friends_other": "{{count}} amis" }
}
```

Rules: no whole sentences as keys; `_one`/`_other` suffixes for anything counted;
interpolation is plain `{{name}}` and never raw HTML (`escapeValue: false`,
because React escapes); typographic apostrophes (`’`) and non-breaking spaces
before `! ? ; :` go in the catalog, not in the JSX.

Two guards, both free — no new test infrastructure:

```ts
// i18next.d.ts — every t('…') call site is checked against en.json
import type en from './locales/en.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en };
  }
}
```

```ts
// locales/index.ts — a key missing from fr is a type error, not an English string on screen
import enJson from './en.json';
import frJson from './fr.json';

type Catalog<T> = { [K in keyof T]: T[K] extends string ? string : Catalog<T[K]> };

export const en = enJson;
export const fr = frJson satisfies Catalog<typeof en>;
```

Extra French keys are *not* caught by `satisfies` (the imported JSON is not a
fresh literal), which is the safe direction: an unused key costs bytes, a
missing one costs a bug. `fr` may also carry `_many` if a count ever reaches
`Intl.PluralRules('fr')`'s `many` category (10⁶); it falls back to `_other`
until then.

---

## 4. Request wiring (SSR)

`createIsomorphicFn` + `getRequestHeader`/`getCookie` from
`@tanstack/react-start/server` on the server, `document.cookie`/`navigator.language`
on the client, one pure `negotiateLocale` so both sides agree and hydration can't
mismatch:

```ts
// i18n/index.ts
export const LOCALE_COOKIE = 'trackt_locale';
export const SUPPORTED_LOCALES = ['en', 'fr'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export function negotiateLocale(cookie: string | undefined, acceptLanguage: string | undefined): Locale {
  if (isLocale(cookie)) return cookie;
  // honour q-values: "fr-FR,fr;q=0.9,en;q=0.8"
  const ranked = (acceptLanguage ?? '')
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      return { base: tag.toLowerCase().split('-')[0] ?? '', q: q ? Number(q.slice(2)) : 1 };
    })
    .sort((a, b) => b.q - a.q);
  const match = ranked.find((entry) => isLocale(entry.base));
  return match ? (match.base as Locale) : 'en';
}

export function createI18n(locale: Locale) {
  const instance = i18next.createInstance();
  void instance.use(initReactI18next).init({
    lng: locale,
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LOCALES,
    resources: { en: { translation: en }, fr: { translation: fr } },
    initAsync: false, // bundled catalogs: initialise synchronously, so SSR never suspends
    interpolation: { escapeValue: false },
  });
  return instance;
}
```

`apps/web/src/router.tsx`:

```ts
const readLocale = createIsomorphicFn()
  .server(() => negotiateLocale(getCookie(LOCALE_COOKIE), getRequestHeader('accept-language')))
  .client(() => negotiateLocale(readCookie(LOCALE_COOKIE), navigator.language));

export function getRouter() {
  configureWebClient();
  const i18n = createI18n(readLocale());
  const queryClient = makeQueryClient();
  return createRouter({
    routeTree,
    // the instance rides in router context so head() can translate titles
    context: { queryClient, i18n },
    Wrap: ({ children }) => (
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </I18nextProvider>
    ),
  });
}
```

Implementation note: if the client bundle ends up pulling the server module in,
move the server branch to `i18n/locale.server.ts` and call it through
`createServerOnlyFn` — the plugin strips server-only imports, but only what it
can see as one.

Why context rather than a `beforeLoad` return: `head()` runs for every route
from its match, and `match.context` is the router context — a route's `<title>`
can be `match.context.i18n.t('meta.profile')` without plumbing a new context key
through the tree. Router context is never serialized, so a non-serializable
instance is fine.

`__root.tsx`: `RootDocument` reads `useTranslation()` and renders
`<html lang={i18n.language}>`; the root `head()` translates the description and
the default title the same way. Verify with `curl -s localhost:3000 | grep -o '<html[^>]*>'`
in both languages — this is the only way to prove SSR is right rather than
"looks fine after hydration".

**Known gap:** TanStack's default not-found/error components are English and
unstyled. A translated `notFoundComponent` on the root route is a five-line
addition; fold it into PR 3 (app shell) rather than a phase of its own.

---

## 5. Switching locale

```ts
export function useLocale() {
  const { i18n } = useTranslation();
  const router = useRouter();
  const setLocale = (locale: Locale) => {
    void i18n.changeLanguage(locale);
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = locale;
    void router.invalidate(); // head() re-runs, so <title> follows the switch
  };
  return { locale: i18n.language as Locale, setLocale };
}
```

- No reload, no navigation, no locale in the URL.
- `router.invalidate()` re-runs `head()` and the (locale-free) loaders. Without
  it the tab title stays in the old language — the kind of bug nobody reports.
- No React Query invalidation: everything cached is content (English either way)
  or numbers.
- Cookie is not `httpOnly` (the client writes it, the server only reads it) and
  carries nothing sensitive.

**Switcher UI** — `components/layout/LocaleMenu.tsx`, on Radix `dropdown-menu`
(already a dependency, and `AccountMenu` is the template):

- Trigger: a compact pill showing the current code (`EN` / `FR`), styled with
  the existing pill tokens; `aria-label={t('locale.switch')}`.
- Menu items read as endonyms — **English**, **Français** — with `aria-current`
  on the active one; Radix owns focus and typeahead.
- Mounted in `AccountMenu` (signed in) and `MarketingNav` (signed out) in PR 7.
  *Not* a seventh item in the app nav: six uppercase tracked labels plus search
  plus avatar is already the width limit, and French makes it worse (§9).

---

## 6. The `packages/client` seam

These helpers return finished English copy or `en-GB` dates, so web has to stop
consuming the copy and start passing the locale:

| Helper | Change |
| --- | --- |
| `KIND_LABELS`, `KIND_LABELS_SINGULAR`, `LOG_STATUS_LABELS`, `TOPIC_LABELS`, `visibilityLabel`, `activityVerbLabel`, `trackingVerbLabel` | **web stops importing them.** New `apps/web/src/lib/labels.ts` maps an exhaustive `Record<MediaKind \| LogStatus \| … , string>` of *keys* through `t()` — the same never-falls-through guarantee the constants gave, in the app that now has a catalog. The English constants stay untouched for `apps/mobile` until its phase |
| `formatNewsDate`, `dateRangeLabel`, `updatedLabel`, `relativeTime`, history `monthLabel`/group labels (`MONTHS`/`SHORT_MONTHS`) | gain a trailing optional `locale` (default `'en-GB'`, so mobile is behaviourally unchanged) and format with `Intl.DateTimeFormat`; the month tables die |
| scores: seven `toFixed(1)` sites | new `formatScore(value, locale)` over `Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })` — `8.5` → `8,5` |

Guardrail that costs one line in CI/review: `grep -rn "KIND_LABELS\|LOG_STATUS_LABELS\|TOPIC_LABELS" apps/web/src`
must be empty when the PR lands (same for `toFixed(` in `apps/web/src`).

`packages/client`'s unit suite gains per-locale assertions for the date/score
helpers (`fr` date, `fr` decimal comma). Those tests are the reason the shared
helpers can stay shared.

---

## 7. Extraction, by surface

Ordered so each PR is reviewable and the app is usable throughout. PR 1 lands
the foundation and the switcher component unmounted; PR 7 adds `fr` and mounts
it, so no intermediate PR is ever half-translated.

| PR | Surface | Main files | ~strings |
| --- | --- | --- | --- |
| 1 | Foundation + switcher (unmounted) | `i18n/**`, `router.tsx`, `__root.tsx`, `LocaleMenu`, `labels.ts`, `formatScore` | — |
| 2 | Marketing + auth | `index.tsx`, `login.tsx`, `register.tsx`, `MarketingNav`, `MarketingFooter`, `AuthLayout` | ~45 |
| 3 | App shell | `AppNav`, `NavSearch`, `AccountMenu`, `ui/*` defaults, root 404 | ~16 |
| 4 | Discover + media detail | `search.tsx`, `media.$slug.tsx`, `components/media/*` | ~41 |
| 5 | Home + history + lists | `home.tsx`, `history.tsx`, `lists.tsx`, `lists_.$id.tsx` | ~54 |
| 6 | Profile + social | `profile.tsx`, `users.$username.tsx`, `ProfileHeader`, `FavouriteShelves`, `AddFriendDialog` | ~55 |
| 7 | News + feedback + errors, and **`fr` enabled** | `news.tsx`, `news_.$slug.tsx`, `components/news/*`, `FeedbackDialog`, `LocaleMenu` mount sites | ~28 |

Notes that shape the work rather than the count:

- **Sentences containing markup** use `<Trans>` with the component passed in,
  not string concatenation — French reorders clauses, and a sentence split
  around a `<Link>` cannot be translated.
- **`aria-label`s are copy too.** The recent accessibility pass moved several
  pills to `aria-labelledby`; those labels now need keys as well, or a screen
  reader gets an English label under a French pill.
- **Error copy:** better-auth returns English messages (`login.tsx:39`,
  `register.tsx:72`) and so does the API. Map `error.code`/status to a key with a
  generic fallback, and keep the "is the instance API reachable?" phrasing local
  (`profile.tsx:287`). Never render a raw API body in French chrome.
- **Don't translate** slugs, URLs, media titles, usernames, `Trackt`, `⌘K`,
  provider names.
- **Uppercase labels stay uppercase in the catalog** (`ACCUEIL`), matching how
  `KIND_LABELS` already works — the design's tracked uppercase is a copy
  decision, not a CSS transform.

---

## 8. Meta and accessibility

- Every route's hardcoded `<title>` (`'Profile — Trackt'`, and 12 siblings)
  becomes `match.context.i18n.t('meta.profile')`. The root default title is
  language-neutral (`Trackt`).
- `<html lang>` correct on the SSR response, and updated on switch.
- The `<meta name="description">` on the landing page is marketing copy and
  should exist in both languages; nothing else in `head()` is translatable.
- No `hreflang`, no locale-prefixed canonical URLs (§1).

---

## 9. French specifics (the part QA will find)

- **Typography:** `’` not `'`; non-breaking space before `! ? ; :`; `« »` with
  NBSPs. Encode in the catalog so JSX stays plain.
- **Plural categories:** French puts 0 in `one` — "0 ami", "2 amis". i18next
  handles it via `Intl.PluralRules`, but the strings must be written for it.
- **Width:** `ACCUEIL`/`DÉCOUVRIR`/`HISTORIQUE` against `HOME`/`DISCOVER`/`HISTORY`;
  `＋ SUIVI` / `NOTER` against `＋ LOG` / `RATE`. The app nav is the tightest row
  in the app — check 1024 and 1280 before and after, and prefer a shorter French
  label (`ACTUS`, `HISTO`) over shrinking the type.
- **Numbers and dates:** `8,5` not `8.5`; `04 févr.` not `04 FEB`; `04 janv. → 11 févr.`
  reads much wider than `04 JAN → 11 FEB`, so the history pill and the log-dates
  dialog need a look.
- **Glyphs:** the fonts are imported as whole-package CSS
  (`apps/web/src/styles.css:2-4`), so `œ`/`Œ`, `«»` and the accented uppercase
  are covered. Confirm once on a French screen rather than trusting the subset.
- **Walk both locales signed in *and* signed out**, on every route in §7, at
  320/768/1024/1440. A missed string shows up as English inside French chrome,
  which is exactly what the walkthrough is for.

---

## 10. Verification

```sh
pnpm --filter @trackt/web typecheck      # typed keys + fr shape check
pnpm lint
pnpm test                                # packages/client locale assertions
pnpm format:check
pnpm --filter @trackt/web dev            # manual pass, both locales
curl -s localhost:3000 | grep -o '<html[^>]*>'   # must say lang="fr" with the cookie
```

Definition of done: no English literal in `apps/web/src/**/*.tsx` outside
comment/code (spot-check with the grep guards in §6); both catalogs complete;
switcher persists across reload and is reflected in SSR; the French walkthrough
in §9 survives at 320px.

---

## 11. Follow-ups (explicitly not in this plan)

1. **`apps/mobile`** — the catalogs move to `packages/i18n` (JSON + typed keys
   stay identical), `expo-localization` supplies the device locale, selector in
   the mobile settings/profile screen. Reuse `negotiateLocale`.
2. **Cross-device preference** — `user.locale` via better-auth
   `additionalFields` and a migration, read at session load and treated as the
   default when no cookie exists.
3. **Content localization** — provider language parameters (`en-US`/`fr-FR`),
   a language column on `catalog_media`, per-locale overviews. Its own ADR.
4. **Locale URLs** (`/fr/…`, `hreflang`) if the public pages ever need search
   visibility per language.
5. **Translator workflow** — Weblate/Crowdin against the JSON catalogs once
   there are more than two languages.
6. **A third locale** (and RTL) — the reason `SUPPORTED_LOCALES` is an array and
   `Locale` is derived from it, not a `'en' | 'fr'` union spelled out per call
   site.

## Effort

Foundation and switcher ~1 day, catalog conversion ~3–4 days (mechanical, one
surface per PR), `packages/client` seam and date/score helpers ~0.5 day, French
QA and fixes ~1 day. **≈6–7 dev-days**, with the ability to stop after any PR
and still have an English app that is internally migrated.
