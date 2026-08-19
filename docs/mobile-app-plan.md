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
| **Shipping**              | EAS build/submit, store metadata, plus the product gaps the stores force: account deletion, pagination, and the GPL-vs-App-Store licence question                                                    |

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

## Phase 0 — decisions and scaffold ✅ built

1. **Licence posture for iOS** — **decided: an App Store exception.**
   [`LICENSE.exceptions`](../LICENSE.exceptions) grants, under GPLv3 §7,
   permission to distribute the mobile binary through app stores whose terms
   conflict with §§4–6. The GPL text is unmodified, the source stays
   GPL-3.0-only, and Android/F-Droid was never affected.
2. **Scope of v1 parity** — the screen table in phase 2 is the whole surface:
   home, discover, news, lists, history, profile, plus pushed media and user
   pages. `/moderation` no longer exists (review moved to the central catalog).
3. **`packages/client` extraction** — done, `apps/web` migrated onto it and
   green. The package owns no transport: `src/runtime.ts` takes an injected `ky`
   instance and an injected `useIsAuthed()` hook, a module singleton rather than
   React context because `trackingApi`/`listsApi`/`friendsApi` are called from
   event handlers with no hook to read a context from. `apps/web/test/lib/`
   moved with the code, and apps/web's vitest setup went with it — nothing left
   in the app is testable without a DOM renderer.

Scaffold, as built:

| File                        | Change                                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/mobile/`              | hand-rolled rather than `create-expo-app` (its template installs with npm and fights the workspace), `"name": "@trackt/mobile"`, expo-router entry |
| `apps/mobile/app.config.ts` | `scheme: 'trackt'`, `app.trackt.client` bundle ids, typed routes. **No `newArchEnabled`** — SDK 57 dropped the flag with the old architecture, so setting it is a type error. EAS project id lands with the first EAS build (phase 5) |
| `apps/mobile/tsconfig.json` | extends `expo/tsconfig.base`, **not** `tsconfig.base.json` (RN needs `moduleResolution: bundler` + `jsx: react-jsx`), with the repo's strict flags re-stated. Originally pinned TypeScript to `~6.0.3` — what SDK 57 expects — but **phase 1 reverted that**: see below |
| `apps/mobile/test/`         | not yet: nothing in the scaffold is pure enough to unit-test. It arrives with phase 1's `lib/instance.ts`, alongside a `test` script         |
| `turbo.json`                | unchanged, as predicted — the app rides the existing per-package fan-out                                                                     |
| `eslint.config.mjs`         | `eslint-plugin-react-hooks` v7 over `apps/mobile/**` and `packages/client/src`. **Not** `eslint-config-expo`: it pins eslint-plugin-react 7.x, which crashes on this repo's ESLint 10 |
| `.github/workflows/ci.yml`  | `pnpm --filter @trackt/mobile doctor` after `pnpm test` in `verify`                                                                          |
| `pnpm-workspace.yaml`       | `nodeLinker: hoisted` **not** needed — Metro bundles the app out of pnpm's isolated layout, workspace packages included. What was needed: `autoInstallPeers: false`, or `@trackt/client`'s `react` peer auto-installs a second React and expo-doctor fails on the duplicate |
| `apps/web/package.json`     | React pinned to `19.2.3`, the version SDK 57 expects — one React across the workspace is what the duplicate-native-module check is protecting |

**Do not** hand-write `metro.config.js` monorepo settings: Metro discovers the
workspace itself on SDK 52+, and stale `watchFolders`/`nodeModulesPaths` are the
top cause of "works on my machine" resolution bugs. Verified: there is no
`metro.config.js` and `expo export` bundles 1282 modules clean.

## Phase 1 — shell: instance, session, tokens ✅ built

The unglamorous phase that everything else assumes. Built as planned, with the
deviations called out below.

- **Server picker** (`app/(setup)/instance.tsx`): origin input → normalize →
  `GET /healthz` → store in SecureStore. Errors distinguish _unreachable_,
  _not a Trackt instance_ (no `{status,version}` body), and _version too old_
  (against `MIN_INSTANCE_VERSION`, which is what gets bumped when a screen needs
  a newer API). `normalizeOrigin` assumes `https://`, allows `http` for LAN
  addresses, drops everything past the authority, and rejects backslashes and
  embedded credentials.
- **`lib/instance.ts`**: the single `resolveInstanceUrl(path)` helper. Every
  `coverUrl`, avatar `image` and `/uploads/*` path goes through it — ADR-0008 §2.
  Kept free of `expo-*` imports so the whole module is unit-testable in a node
  vitest project; SecureStore lives in `lib/storage.ts` next door.
- **Auth** (`lib/auth-client.ts`): `createAuthClient` with `expoClient({ scheme:
'trackt', storagePrefix: 'trackt', storage: SecureStore })` and `baseURL` set
  from the picked instance. Requests to `/api/v1/*` attach
  `authClient.getCookie()` as a `Cookie` header with `credentials: 'omit'` —
  setting both is the documented footgun. The client is **built per instance and
  memoised**, not created once: replaying instance A's cookie at instance B is
  the bug the picker exists to make impossible.
- **Server side** (`apps/api/src/auth.ts`): `expo()` in `plugins`, `'trackt://'`
  + `'trackt://*'` in `trustedOrigins`, `exp://*` in development. One deviation:
  `expo() as BetterAuthPlugin`. Left inferred, the plugin's endpoint types pull
  `better-call` and `@better-auth/core` into the exported `Auth` type by their
  peer-suffixed pnpm paths, which TypeScript cannot name (TS2742). Nothing
  server-side calls an expo endpoint by name, so the inference buys nothing.
- **Login / register** (`app/(auth)/`): the two existing better-auth flows,
  email+password with the username plugin, with web's client-side validation
  duplicated so a 400 lands on the field that caused it. `safeRoute` in
  `lib/instance.ts` is `safeRedirect`'s mobile analogue.
- **The gate is two gates, of different kinds.** _Instance_ is structural: the
  signed-in routes sit inside `<Stack.Protected guard={!!origin}>`, so a cold
  deep link resolves to the picker — and, load-bearing, nothing can call a hook
  on an auth client that has not been built yet. _Session_ is imperative and
  per-screen (`useAuthedScreen`), mirroring `useAuthedPage()`. Both are reachable
  in reverse: login carries a "change server" affordance, because a
  typo'd-but-live origin would otherwise be a reinstall.
- **Theme** (`theme/tokens.ts`, `theme/typography.ts`): colours, radii, spacing,
  and the three font families from `docs/design/README.md`, plus the four
  primitives: `<AuraBackground>`, `<GlassCard>` (`expo-blur` + border),
  `<PrismButton>` (linear gradient pill), `<PrismText>` (MaskedView + gradient).
  Two notes. The aura is **SVG ellipses with radial-gradient fills**, sized in
  fractions of the screen — RN has no gradient background. The **grain film is
  not ported**: it needs `mix-blend-mode: overlay` over tiled noise, which RN
  cannot express, and at phone sizes the difference is invisible. Fonts are
  imported by weight subpath (`@expo-google-fonts/archivo/500Medium`), never from
  the package root, which `require()`s all nineteen faces — 2.3 MB of italics.

Two things bit that the plan did not predict:

| Surprise                     | Resolution                                                                                                                                                                                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Two TypeScript majors**    | The `~6.0.3` pin phase 0 accepted became an expo-doctor failure once `expo-font`/`expo-asset` entered the graph: `typescript` is an optional peer of the expo tooling, so two majors produce two peer-suffixed `expo` instances and the duplicate-native-module check fails. The workspace is back on one TypeScript (`~5.9.3`); mobile typechecks clean on it |
| **Typed routes are local-only** | `.expo/types/router.d.ts` is generated by `expo start` (not by `expo export`) and is gitignored, so CI typechecks with the loose fallback `Href`. CI is therefore weaker here, never falsely red — a bad `href` is caught locally after the dev server has run at least once   |

Deliberately **not** in phase 1: `(app)/home.tsx` is a placeholder that fetches
nothing. Every `GET` on it belongs to phase 2's `(tabs)/home`, which replaces the
file wholesale.

## Phase 2 — read-only parity ✅ built

The app ships as a viewer first; every screen here is a `GET`. Built as planned
except for the navigation shape, which the mobile design handoff settled after
this plan was written — see below.

| Tab / route                       | Web equivalent                              | Endpoint(s)                                                         |
| --------------------------------- | ------------------------------------------- | ------------------------------------------------------------------- |
| `(tabs)/home`                     | `routes/home.tsx`                           | `GET /me/home`                                                      |
| `(tabs)/discover`                 | `routes/search.tsx`                         | `GET /search?q=&kind=` (250 ms debounce — 60/min bucket)            |
| `(tabs)/news` + `news/[slug]`     | `routes/news.tsx`, `news_.$slug.tsx`        | `GET /news` (keyset cursor → `useInfiniteQuery`), `GET /news/:slug` |
| `(tabs)/profile`                  | `routes/profile.tsx`                        | `GET /me/profile`                                                   |
| `lists/` + `lists/[id]` (pushed)  | `routes/lists.tsx`, `lists.$id.tsx`         | `GET /lists`, `GET /lists/:id`                                      |
| `history` (pushed)                | `routes/history.tsx` (ADR-0007)             | `GET /me/history` (keyset, year/season/kind/status filters)         |
| `users/[username]` (pushed)       | `routes/users.$username.tsx`                | `GET /users/:username/profile`                                      |
| `media/[slug]` (pushed)           | `routes/media.$slug.tsx`                    | `GET /media/:idOrSlug`                                              |
| signed-out landing                | `routes/index.tsx`                          | skipped — on mobile the picker is the first screen                  |

**Four tabs, not six.** `docs/design/Mobile System.dc.html` §03 fixes the spine
as HOME · DISCOVER · NEWS · PROFILE and puts **Lists and History inside
Profile**, as two rows under the stat band: four 90pt targets clear the 44pt
minimum with room for a mis-tap, and a fifth squeezes the labels below 10px.
This plan had already guessed History would move; Lists moved with it, for the
same reason — both are weekly destinations, not daily ones.

How the four notes landed:

- **News markdown**: done. `packages/client/src/markdown.ts` is the tokenizer —
  `parseMarkdown` → blocks of `InlineToken`s, with `safeHref` applied at
  tokenizing time so an unsafe target degrades to plain text before either
  client sees it. Web's `Markdown.tsx` is now just the token → element map, and
  the app's is the token → `<Text>` map. No `WebView` anywhere; a new
  `markdown.test.ts` pins the security branches (unsafe link, raw HTML).
- **Generated covers**: `coverGradient` split into `coverGradientStops`, which
  is what `expo-linear-gradient` takes; the CSS-string form composes from it, so
  the hash and hue tables have exactly one copy and a title looks the same on
  both clients. `avatarGradient` got the same treatment.
- **Episode/chapter grid**: the media screen *is* a `FlashList` — the part rows
  are its data and the hero, synopsis and related shelves are its header and
  footer. A grid with no ceiling (hundreds of manga chapters) cannot sit inside a
  `ScrollView`, and a `FlashList` nested in one recycles nothing.
- **History's year rail**: a horizontally scrolling chip row rather than a
  sticky segmented control — with the season chips beside it behind a hairline,
  always rendered and dimmed to inert on ALL TIME, exactly as on web.

Deviations worth knowing:

- **Nothing mutates yet, and nothing pretends to.** The up-next rows open the
  title instead of checking in; part tiles show watched state but are not
  pressable and are not styled as buttons; friend state and log status read as
  labels. The swipe check-in (`Mobile System.dc.html` §04) is phase 3 + 4.
- **Lists drops the mockup's MY LISTS / FOLLOWING / COLLABORATIVE tabs.**
  `ListsQuerySchema.scope` admits only `mine`, so two of the three are
  permanently empty; web renders them visibly inert to hold the mockup's shape,
  and a phone has no room for a control that cannot do anything.
- **Tabs are `expo-router/ui`'s headless ones**, not the drop-in navigator: the
  bar is glass over the aura with a pink glyph + label + an 18×2 rule, which the
  navigator's options cannot express. Its four glyphs are SVG rather than the
  mockup's ▤ ⌕ ◈ ◍ characters — none of the three loaded faces ships them, so
  the system fallback would pick per platform.
- **`app/index.tsx` still owns `/`**, so the home tab is `/home`. Two files
  resolving to `/` is a route collision, and the entry route is what decides
  picker vs. login vs. app.

## Phase 3 — the tracking actions ✅ built

The point of the app. Everything below existed server-side and was already
exercised by web, so the phase was optimistic-update plumbing plus feel — and it
added no data layer: `invalidateTracking()` is reused verbatim, as planned.

| Action                              | Where it landed                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| Check in / uncheck a part           | The media grid's tiles, now real buttons, and the up-next rows on Home                    |
| Status, rating, favourite           | `StatusSheet`, `RatingSheet`, and a pill that toggles — all on the media hero              |
| Log dates (ADR-0007)                | `LogDatesSheet`, over the platform date picker                                             |
| Lists: create/edit/delete, add/remove/reorder | `ListFormSheet` + `AddToListSheet`, the owner controls on the list screen         |
| Profile edit + avatar               | `EditProfileSheet`, `expo-image-picker` → the existing multipart route                     |
| Friends: search, request, accept, unfriend | `FriendsSheet` on Profile, and the action button on a public profile                |

Six things are worth knowing about how it landed.

- **`Sheet` is a plain RN `Modal`, mounted on demand.** It is the platform's own
  presentation on both OSes — Android's back button and iOS's dismiss come free —
  and every sheet here is a form with a button, not a scrubbable surface. What
  that costs is the spec's 42%/92% detents, which become a `maxHeight`, and the
  dismiss animation, which needs the element to outlive the state. Mounting on
  demand rather than behind an `open` flag is not a style choice: `AddToListSheet`
  and `FriendsSheet` run queries, and one held mounted on the media screen would
  fetch the viewer's lists for every title they opened.
- **The undo toast, not the swipe.** `Mobile System.dc.html` §04's gesture needs
  gesture-handler and Reanimated and belongs to phase 4, but the *rule* behind it
  is a phase-3 semantic and shipped now: a check-in commits instantly, with no
  confirmation, and an undo toast sits above the tab bar for five seconds. The
  one confirmation in the app is deleting a list, which has no undo — that is
  what makes it legitimate rather than habitual.
- **Haptics arrived early, in the three §07 flavours only** (`lib/haptics.ts`):
  medium impact on a commit, selection tick on crossing a threshold, error
  notification on a rejected write. Named by event rather than waveform, so the
  rule stays enforceable at the call site. Every call swallows its rejection — a
  simulator rejects rather than no-ops, and a check-in must not fail because the
  phone would not buzz.
- **`validateLogDates` moved into `packages/client`.** Both clients now have a
  date form, and web's two typed `YYYY-MM-DD` fields and the app's bounded
  pickers can produce different mistakes; neither may accept what the other
  rejects. `isoToDate`/`dateToIso` stayed in the app (`lib/dates.ts`) but got a
  test each — both guard an off-by-one day that only appears away from UTC, which
  a manual pass in one timezone never finds.
- **The rating stars are the readout, not the input.** Half-star hit targets are
  12px on web; the input underneath is a scrolling row of the 21 values the
  schema admits, each a real 44pt target. Phase 4 adds the pan gesture across the
  stars — the chips stay, because a pan is not one-handed and switch control has
  nothing to pan.
- **Two packaging surprises**, both from the new native deps.
  `@react-native-community/datetimepicker`'s config plugin `require`s
  `@expo/config-plugins` without declaring it, which pnpm's isolated layout
  cannot resolve — `expo config` died before reading the app config at all, so
  `expo-doctor` (and CI) failed on a green project. Fixed with a
  `packageExtensions` entry in `pnpm-workspace.yaml`. And `expo-image-picker`'s
  defaults add a camera usage string and `RECORD_AUDIO` to the manifest; the
  avatar flow only opens the library, so both are turned off explicitly.

Deliberately **not** in phase 3: social links. `PATCH /me/profile` takes them,
but the app does not *show* them anywhere yet, and a form that edits fields the
reader cannot see is a worse gap than the one it closes. `UpdateProfileBody` is a
partial, so omitting the key leaves what was set on web untouched — that is what
makes leaving it out safe rather than destructive. Showing them, and editing them,
is a read-parity item left over from phase 2.

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

| Gap                           | Where it lands                                                                                               |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `DELETE /me` account deletion | `apps/api` — required for App Store submission, and the missing half of the portability principle             |
| Library endpoint (keyset)     | Already in the roadmap backlog; mobile makes it load-bearing. `/news` and `/me/history` are the shape to copy |
| GPL-3.0 vs. App Store terms   | Phase 0 decision                                                                                              |
| Demo instance for App Review  | A reviewer has no server; a server-picker-first app reads as "minimum functionality" (4.2) without one        |

Report/block is **no longer on this list**: entry creation moved to the central
catalog, so the app carries no user-authored titles or covers. Profile fields and
list names remain user-supplied — worth revisiting if comments land.

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
