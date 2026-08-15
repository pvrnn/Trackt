# Mobile app plan (React Native + Expo)

Companion to [ADR-0008](adr/0008-first-party-mobile-client.md), which records _why_ each
decision below was taken. This document is the build order.

The goal is **parity with `apps/web`** — the same six sections, the same tracking
actions, the same data — with a native feel: gesture navigation, haptic check-ins,
and motion that carries state changes rather than decorating them.

## What "add a mobile app" actually requires

Beyond `npx create-expo-app`, the work splits into five buckets. Only the first is
obvious.

| Bucket                    | Why it isn't optional                                                                                                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Instance addressing**   | Trackt has no canonical server. The app opens on a server picker, and every URL — API, auth, `/uploads/*` — derives from the chosen origin (ADR-0008 §2)                                             |
| **Auth transport**        | React Native has no cookie jar. `@better-auth/expo` + SecureStore on the client; `expo()` plugin + `trackt://` in `trustedOrigins` on the server (2 lines in `apps/api/src/auth.ts`)                 |
| **Shared data layer**     | `apps/web/src/lib/` is already platform-neutral except `auth-client.ts`. Extract it to `packages/client` before writing the second copy, not after — and its `apps/web/test/lib/` suite goes with it |
| **Design system port**    | AURA PRISM's signatures (radial aura, grain, glass blur, PRISM gradient text) are CSS recipes with no React Native equivalent — each needs a native rebuild                                          |
| **Shipping**              | EAS build/submit, store metadata, plus four product gaps the stores and the platform force: account deletion, report/block, pagination, and the GPL-vs-App-Store licence question                    |

## Stack

| Concern       | Choice                                                                                       | Note                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Runtime       | **Expo SDK 57** (RN 0.86, React 19.2)                                                        | New Architecture on by default — Reanimated 4 requires it                                         |
| Routing       | **expo-router** (the version shipping with SDK 57)                                           | File-based; six tabs mirroring `AppNav`'s `NAV_ITEMS`, native stack for pushes                     |
| Data          | `@tanstack/react-query` (already a web dep)                                                  | Same query keys and invalidation as web, via `packages/client`                                     |
| Auth          | `better-auth` + `@better-auth/expo` + `expo-secure-store`                                    | Also `expo-network`, `expo-linking`, `expo-constants` per the plugin's requirements                |
| Animation     | `react-native-reanimated` 4 + `react-native-gesture-handler`                                 | CSS-style declarative API for the simple cases, worklets for gestures                              |
| Images        | `expo-image`                                                                                 | Built-in transition/placeholder; covers are the app's whole visual weight                          |
| Lists         | `@shopify/flash-list`                                                                        | Manga check-in grids run to hundreds of tiles, and History is an infinite keyset feed              |
| Visuals       | `expo-blur`, `expo-linear-gradient`, `react-native-svg`, `@react-native-masked-view/masked-view` | Glass, PRISM gradient, radial aura, gradient text respectively                                     |
| Type          | `@expo-google-fonts/{anton,archivo,space-grotesk}`                                           | The `@fontsource/*` packages the web app uses ship woff2; RN needs ttf                             |
| Storage       | `react-native-mmkv` + `@tanstack/react-query-persist-client`                                 | Offline cache and the paused-mutation queue (phase 5)                                              |
| Feedback      | `expo-haptics`                                                                               | One-tap check-in is the product's core gesture (PRD §8: ≤2 interactions)                          |
| Media picking | `expo-image-picker`                                                                          | Avatar and user-entry covers, multipart to the existing routes                                     |
| Dates         | the platform date picker (`@react-native-community/datetimepicker`)                          | Log start/finish dates (ADR-0007) — `LogDatesDialog`'s two text inputs become one native sheet     |

Not adopted: **NativeWind** (ADR-0008 §5), **push notifications** (ADR-0008 §7),
**shared-element transitions as a dependency** (ADR-0008 §6).

## Phase 0 — decisions and scaffold

Nothing below phase 1 can be finished without these, and two of them are the
user's call, not an engineering one.

1. **Licence posture for iOS** (ADR-0008 consequences). GPL-3.0-only vs. the App
   Store's usage rules. Android/F-Droid is unaffected either way. Options: ship
   Android first, add an App Store exception clause to `LICENSE`, or license
   `apps/mobile` permissively. **Decide before writing screens.**
2. **Scope of v1 parity.** Recommended cut: everything except `/moderation`
   (moderator tooling reads fine on a phone browser) — see the screen table.
3. **`packages/client` extraction** — do it as its own PR, with `apps/web`
   migrated onto it and green, so the mobile PRs never mix "moved code" with
   "new code". `apps/web/vitest.config.ts` already scopes a node-environment
   suite over the pure half of `src/lib`; that config and those five test files
   are the template for the package's own suite.

Scaffold, once those land:

| File                             | Change                                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `apps/mobile/`                   | `create-expo-app` with the expo-router template, `"name": "@trackt/mobile"`                                |
| `apps/mobile/app.config.ts`      | `scheme: 'trackt'`, bundle ids, EAS project id, `newArchEnabled`                                           |
| `apps/mobile/tsconfig.json`      | extends `expo/tsconfig.base`, **not** `tsconfig.base.json` (RN needs `moduleResolution: bundler` + `jsx: react-jsx`) |
| `apps/mobile/test/`              | unit tests mirroring `src/`, `*.test.ts` — the convention in `AGENTS.md`                                   |
| `turbo.json`                     | no change needed — `dev`/`typecheck`/`lint`/`test` tasks already fan out per package                       |
| `eslint.config.mjs`              | add the Expo/React Native config for `apps/mobile/**`                                                      |
| `.github/workflows/ci.yml`       | `apps/mobile` rides the existing `pnpm lint`/`typecheck`/`test`; add `npx expo-doctor` to `verify`         |
| `pnpm-workspace.yaml`            | only if a native dep resists pnpm's isolated layout → `nodeLinker: hoisted`                                |

**Do not** hand-write `metro.config.js` monorepo settings: Metro discovers the
workspace itself on SDK 52+, and stale `watchFolders`/`nodeModulesPaths` are the
top cause of "works on my machine" resolution bugs.

## Phase 1 — shell: instance, session, tokens

The unglamorous phase that everything else assumes.

- **Server picker** (`app/(setup)/instance.tsx`): origin input → normalize →
  `GET /healthz` → store in SecureStore. Errors distinguish _unreachable_,
  _not a Trackt instance_ (no `{status,version}` body), and _version too old_.
- **`lib/instance.ts`**: the single `resolveInstanceUrl(path)` helper. Every
  `coverUrl`, avatar `image` and `/uploads/*` path goes through it — ADR-0008 §2.
- **Auth** (`lib/auth-client.ts`): `createAuthClient` with `expoClient({ scheme:
'trackt', storagePrefix: 'trackt', storage: SecureStore })` and `baseURL` set
  from the picked instance. Requests to `/api/v1/*` attach
  `authClient.getCookie()` as a `Cookie` header with `credentials: 'omit'` —
  setting both is the documented footgun.
- **Server side** (`apps/api/src/auth.ts`): add `expo()` to `plugins`, and
  `'trackt://'` + `'trackt://*'` to `trustedOrigins` (plus `exp://*` when
  `NODE_ENV !== 'production'`, next to the existing localhost:3000 exception).
- **Login / register** (`app/(auth)/`): the two existing better-auth flows,
  email+password with the username plugin. Session gate mirrors
  `useAuthedPage()` from web, redirecting to the picker when no instance is set
  and to login when no session is. `safeRedirect` from `lib/url.ts` has a mobile
  analogue: a deep link may only resolve to an in-app route.
- **Theme** (`theme/tokens.ts`, `theme/typography.ts`): colours, radii, spacing,
  and the three font families from `docs/design/README.md`. Plus the four
  primitives the design leans on everywhere: `<AuraBackground>` (svg radial
  stack + tiled grain, absolutely positioned, `pointerEvents="none"`),
  `<GlassCard>` (`expo-blur` + border), `<PrismButton>` (linear gradient pill),
  `<PrismText>` (MaskedView + gradient).

## Phase 2 — read-only parity

Ship the app as a viewer first; every screen here is a `GET`.

| Tab / route                          | Web equivalent                              | Endpoint(s)                                                                  |
| ------------------------------------ | ------------------------------------------- | ---------------------------------------------------------------------------- |
| `(tabs)/home`                        | `routes/home.tsx`                           | `GET /me/home`                                                               |
| `(tabs)/discover`                    | `routes/search.tsx`                         | `GET /search?q=&kind=` (debounce ≥250 ms — 60/min bucket)                    |
| `(tabs)/news` + `news/[slug]`        | `routes/news.tsx`, `news_.$slug.tsx`        | `GET /news` (keyset cursor → `useInfiniteQuery`), `GET /news/:slug`          |
| `(tabs)/lists` + `lists/[id]`        | `routes/lists.tsx`, `lists.$id.tsx`         | `GET /lists`, `GET /lists/:id`                                               |
| `(tabs)/history`                     | `routes/history.tsx` (ADR-0007)             | `GET /me/history` (keyset, year/season/kind/status filters)                  |
| `(tabs)/profile`, `users/[username]` | `routes/profile.tsx`, `users.$username.tsx` | `GET /me/profile`, `GET /users/:username/profile`                            |
| `media/[slug]` (pushed)              | `routes/media.$slug.tsx`                    | `GET /media/:idOrSlug`                                                       |
| signed-out landing                   | `routes/index.tsx`                          | `GET /media/showcase` — or skip it: on mobile the picker is the first screen |
| —                                    | `routes/moderation.tsx`                     | **deferred** (phase 0 decision)                                              |

Six tabs is one more than iOS wants to show comfortably; History is the natural
candidate to live under Profile rather than in the bar, matching how `AppNav`
already treats it as a secondary destination.

Notes that will bite otherwise:

- **News markdown**: the "React elements, never HTML strings" guarantee
  (ADR-0005) must survive the port. Extract the tokenizer from
  `components/news/Markdown.tsx` into `packages/client` (with `safeHref` from
  `lib/url.ts`, which it already depends on); map tokens to `<Text>` in the app.
  Never reach for a markdown-to-HTML renderer in a `WebView`.
- **Generated covers**: `apps/web/src/lib/cover.ts` is pure, portable and now
  unit-tested — move it with the client package and render the two-stop gradient
  with `expo-linear-gradient` (the hash and hue tables are unchanged, so a
  title's cover looks identical on both clients).
- **Episode/chapter grid**: the web page already deviates from the mockup to a
  compact tile grid for exactly the reason mobile will — put it in a FlashList.
- **History's year rail** is a horizontal scroller of years with counts; on
  mobile it wants to be a sticky segmented control, not a sidebar.

## Phase 3 — the tracking actions

The point of the app. All of these exist server-side and are already exercised
by web, so this phase is mostly optimistic-update plumbing plus feel.

- Check in / uncheck a part → `PUT|DELETE /media/:id/progress/:number`
- Status, rating, favourite → `PUT|DELETE /media/:id/log`, `/media/:id/rating`,
  `/media/:id/favorite`
- **Log dates** → `PATCH /media/:id/log` (ADR-0007). Status changes stamp
  `started_at`/`finished_at` server-side; this is the manual correction, and it
  is the one form in the app that genuinely improves on web — a native date
  picker beats two typed `YYYY-MM-DD` fields
- Lists: create/rename/delete, add/remove/reorder → `/lists*`
- Profile edit + avatar → `PATCH /me/profile`, `POST /me/avatar` (multipart,
  2 MB cap, from `expo-image-picker`)
- Friends: search, request, accept, unfriend → `/me/friends*`, `/users/search`
- Create entry + cover → `POST /media`, `POST /media/:id/cover`

Reuse `invalidateTracking()` verbatim from `packages/client`: one check-in
invalidates `['media']`, `['home']`, `['profile']` and `['history']`, and that
fan-out has been extended twice after cache-staleness bugs — re-deriving it here
would re-introduce them.

## Phase 4 — motion

Smooth is a phase, not a side effect. The inventory, cheapest first:

| Interaction        | Technique                                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| Check-in button    | Reanimated spring scale + `expo-haptics` `impactAsync(Light)` on press-in, tick draws in on success        |
| Episode tile fill  | `withTiming` on background/border, staggered when `completed` sweeps the whole grid                        |
| Screen push        | Native stack (platform-correct by construction, gesture back for free)                                     |
| Media hero         | Parallax cover on scroll (`useAnimatedScrollHandler`), title fading into the header                        |
| Tab switch         | `entering`/`exiting` layout animations on the content, not the tab bar                                     |
| Lists & shelves    | `Layout` transitions on reorder, `FadeIn` stagger on first paint                                           |
| History            | Year switch cross-fades the totals row; new pages append with a stagger instead of a jump                  |
| Rating             | Gesture-handler pan across the half-step star row                                                          |
| Sheets             | Native modal presentation for add-to-list / rate / status / log dates                                      |
| Skeletons          | Reanimated shimmer keyed to the same query states web uses                                                 |

Two rules: honour reduced-motion (PRD §6), and never animate a state change the
server hasn't confirmed _without_ a rollback path — the optimistic update and
its animation are one unit.

## Phase 5 — offline, then shipping

**Offline** (the subway case — check-ins are the one action people take with no
signal): persist the React Query cache to MMKV, drive `onlineManager` from
`expo-network`, and register mutation defaults with `setMutationDefaults` so
paused check-ins resume on reconnect. Read screens serve last-known data with a
staleness marker rather than a spinner.

**Shipping**: EAS Build profiles (dev client / preview / production), EAS Submit,
EAS Update for JS-only fixes. Store listings need a privacy policy, and the app
needs the four gaps from ADR-0008 closed or consciously accepted:

| Gap                                     | Where it lands                                                                                             |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `DELETE /me` account deletion           | `apps/api` — required for App Store submission, and the missing half of the portability principle             |
| Report / block for user-created content | `apps/api` + moderation queue                                                                                 |
| Library endpoint (keyset)               | Already in the roadmap backlog; mobile makes it load-bearing. `/news` and `/me/history` are the shape to copy |
| GPL-3.0 vs. App Store terms             | Phase 0 decision                                                                                              |

## Verification

- `pnpm lint` / `pnpm typecheck` / `pnpm test` cover the app through the existing
  Turborepo fan-out; `expo-doctor` joins CI's `verify` job.
- Unit tests go in `apps/mobile/test/` mirroring `src/` (`AGENTS.md`), in a
  node-environment vitest project like `apps/web/vitest.config.ts` — the pure
  half only. Component and screen tests need a renderer and are out of scope
  here, exactly as they are on web.
- One test worth writing on day one: the **token drift guard** — parse the hex
  values out of `apps/web/src/styles.css` and assert `theme/tokens.ts` matches.
- Manual passes on a physical iOS and Android device against a local instance
  (the `start-app` skill brings the dev stack up; point the app at the LAN IP
  rather than `localhost`), and against a second instance to prove the picker.
