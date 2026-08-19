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

## Phase 4 — motion ✅ built

Smooth is a phase, not a side effect. The inventory, and where each item landed:

| Interaction        | How it shipped                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| **Swipe check-in** | `SwipeCheckIn` — §04's thresholds, the tick at 96pt, the exit and the collapse (below)                               |
| Check-in button    | `usePressMotion`: a 140ms spring to 0.96 under the finger, on every pressable in the app                             |
| Episode tile fill  | `interpolateColor` over 140ms; staggered only when a status change sweeps the whole grid                             |
| Screen push        | Native stack — already free since phase 1                                                                            |
| Media hero         | Cover parallax on scroll, fading into a 44pt glass `HeaderBar` that takes the title                                  |
| Tab switch         | `PageFrame fadeOnFocus` — the content, never the bar                                                                 |
| Lists & shelves    | `LinearTransition` on the ranked list's reorder, `FadeIn` stagger on the home shelf and feed                         |
| History            | The totals row cross-fades when the year changes; appended pages stagger in instead of jumping                       |
| Rating             | A pan across the star row, ticking at each half step                                                                 |
| Sheets             | Present, dismiss **and drag** — the thing phase 3's `Modal` gave up                                                  |
| Skeletons          | `Skeleton`/`SkeletonRows` where the screen already knows the shape it is about to draw                               |

The two rules held: reduced motion is honoured, and no state change is animated
without a rollback path — the optimistic update and its animation are one unit.

Six things are worth knowing about how it landed.

- **The swipe is not the only check-in, and that is deliberate.** §04 says "a
  dim chevron is the only affordance"; the button phase 3 built stays anyway. A
  pan has nothing to offer VoiceOver, TalkBack or switch control, and the
  design's version would leave those users with no check-in at all. Same
  reasoning as the rating chips under the now-draggable stars: the gesture is
  the fast path, never the only one.
- **The exit is driven by state, not by the gesture.** `SwipeCheckIn` takes a
  `committed` prop and plays the 220ms exit from it, so the button and the swipe
  animate identically — and so the row can come *back*. An undo, or a write the
  server rejected, flips the prop and the row springs open again. Driving the
  exit from `onEnd` would have made the swipe a one-way door, which is exactly
  the rule about rollback paths.
- **`useSheetController`, because a dismiss animation needs the element to
  outlive the state.** The sheets are still mounted on demand — that was never
  the negotiable part — so the exit has to run *before* the parent unmounts
  them. The controller lives in the parent, `dismiss()` plays the exit and only
  then calls `onClose`. It could not live inside `<Sheet>`: the sheets close
  themselves from handlers defined outside their own JSX (`RatingSheet` on SAVE,
  `ConfirmSheet` on confirm), and those handlers need the animated dismiss.
- **The one thing the phase did not get is a worklet scroll handler on
  `FlashList`.** `FlashList` invokes its `onScroll` prop as an ordinary JS
  callback, so a `useAnimatedScrollHandler` passed to it is never recognised as
  one. The media hero therefore writes the offset from a plain handler and
  derives everything else on the UI thread: only the input crosses the bridge.
  `renderScrollComponent` + `useScrollOffset` would close that gap and is worth
  revisiting, but it means reaching into how the list mounts its scroll view.
- **`react-hooks/immutability` is off for `apps/mobile`.** Reanimated mutates
  shared values by design — `x.value = withSpring(…)` *is* the API — and the
  object has to appear in an effect's dependency list for the effect to be
  correct. The React Compiler rule reads that as a write to captured state, and
  no shape of the Reanimated API satisfies it. Off at the config level rather
  than suppressed line by line, because a disable comment on every animated file
  is how a rule stops being read. Everything else in the recommended set stays
  on, including `refs`, which caught a real mistake during this phase.
- **No press haptic.** The inventory asked for `impactAsync(Light)` on the
  check-in button's press-in; §07 reserves haptics for a commit, a threshold and
  a failure, and §07 wins. A button that buzzes on press spends the feedback
  before the thing it does has happened. The threshold tick on arming the swipe
  and the commit impact on the check-in itself are both there.

Reduced motion needs **no wiring at all**, which took running the app to learn:
`ReduceMotion.System` is already every Reanimated animation's default, so the
`<ReducedMotionConfig>` that documented it changed nothing and cost a LogBox
warning on every launch. It is gone. With the OS setting on, every
`withTiming`/`withSpring` resolves straight to its end value (PRD §6), and the
few places that must do something *different* rather than merely faster read
`useReducedMotion()` themselves — the swipe row does not exit or collapse at all
under it, falling back to phase 3's behaviour of staying put with a checked-in
button.

## Phase 5 — offline, then shipping ✅ offline built; shipping staged

Two halves that share a phase only because the store forces them together. The
offline half is built. The shipping half is built as far as a repository can
take it — everything that is code or configuration is in; everything that needs
an EAS account, an Apple team or a running demo server is documented in
[`mobile-shipping.md`](mobile-shipping.md) and named below.

### Offline

The subway case, and check-ins are the one action people take with no signal.

| Piece                | Where it landed                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| Cache on disk        | `lib/persist.ts` — MMKV behind `createSyncStoragePersister`, restored by `PersistQueryClientProvider`      |
| Connectivity         | `lib/network.ts` — `onlineManager.setEventListener` fed by `expo-network`, plus `useIsOnline()` for the UI |
| Queued writes        | `lib/offline.ts` — `TrackingWrite`, `runTrackingWrite`, `setMutationDefaults(TRACKING_MUTATION_KEY, …)`    |
| Staleness            | `StaleNotice` on Home, Profile, News, History, Lists and the media screen; `OfflineFallback` for a cold one |

Five things are worth knowing about how it landed.

- **A closure cannot survive a queue, so the writes stopped being closures.**
  Phase 3's `apply(patch, () => trackingApi.checkIn(id, n))` was the thing that
  had to go. A mutation React Query pauses is persisted as its `mutationKey` and
  its variables and *nothing else*, so on the next launch there is no function
  left to call. The write is now a value — `{ op: 'checkIn', id, part }` — the
  request comes from `runTrackingWrite` via the client's mutation defaults, and
  the optimistic patch is **derived** from that same value by `trackingPatch`
  rather than passed beside it. Two things fell out of that which were not the
  goal: the sweep rules for `completed`/`planned` and the ADR-0007 date stamping
  moved out of the media screen into a pure function, and the whole write path
  became testable in the node vitest project.
- **The invalidation had to move too, for the same reason.** A write that
  resumes on reconnect has no screen behind it, so `invalidateTracking`'s
  four-key fan-out is registered in the mutation *defaults*, not only in the
  hook. Without that a queued check-in would land on the server and leave home,
  profile and history stale until the app was killed.
- **One cache per instance, keyed by origin.** The query keys are `['media',
slug]`, `['home']` — nothing in them names a server, so a single persisted dump
  would let instance A's library be restored into instance B's session. The
  persister key carries the origin, the `QueryClient` is rebuilt with it (the
  layout is keyed on origin rather than carrying a dependency array that
  pretends to say so), and **Change server** deletes that instance's entry on
  the way out, which is the last moment anything knows which key it was.
- **Offline changes when the commit feedback fires, and it has to.** §07 puts
  the impact on a committed write, which online means the server's 200. Offline
  there will never be one — so the haptic and the undo toast fire at queue time
  instead, and the toast says `· will sync` so the difference is stated rather
  than hidden. It is the same rule, not a second one: the buzz answers "your tap
  did something", and offline the queueing is the something.
- **`networkMode: 'online'` pauses queries as well as mutations**, which is a
  trap: a screen with nothing cached does not fail offline, it stays `isPending`
  forever, and an endless skeleton is indistinguishable from a hang. Hence
  `OfflineFallback`, which wraps the skeleton rather than sitting beside it so
  no screen has to reach for `useIsOnline` to state the rule.

Two things the plan asked for and did not get. There is **no exponential
backoff or retry ceiling** on the queue beyond React Query's own — a write that
the server rejects on resume rolls nothing back, because the context that would
roll it back was not persisted either; it invalidates instead, and the truth
arrives with the refetch. And the persisted cache is **not encrypted**: MMKV
supports it, the session token is in SecureStore where it belongs, and what is
left is a list of what you watched, on a device that is already locked.

### Shipping

| Gap                           | Where it landed                                                                                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DELETE /me` account deletion | Built. `apps/api/src/routes/v1/profile.ts`, delegating to better-auth's `deleteUser`; `DeleteAccountSheet` on Profile → Account                                     |
| Library endpoint (keyset)     | **Already closed** — `GET /v1/me/history` (ADR-0007) is the keyset-paged whole collection, and superseded the backlog item before this phase started                |
| GPL-3.0 vs. App Store terms   | Phase 0 decision, unchanged                                                                                                                                        |
| Demo instance for App Review  | The app's half is built: `TRACKT_DEMO_INSTANCE` at build time → `extra.demoInstance` → a **Use the demo instance** button on the picker. The server behind it is ops |
| EAS build / submit            | `apps/mobile/eas.json` — `development` / `preview` / `production`, plus the Android submit config                                                                   |
| EAS Update                    | **Not wired.** The profiles name channels; `expo-updates` and `updates.url` embed a project id that does not exist until the first `eas init`                       |
| Privacy policy                | [`mobile-privacy.md`](mobile-privacy.md) — short because the app has no backend, and saying so precisely beats boilerplate                                          |

Three things are worth knowing.

- **Deletion is delegated, not re-implemented.** `DELETE /api/v1/me` is a thin
  `/v1` wrapper over better-auth's `deleteUser`: verifying the password against
  the credential account and revoking every live session are the two things this
  must not get wrong, and both are already correct one layer down. What the
  wrapper adds is the surface the clients actually speak — one prefix, one
  session header, one error shape, one OpenAPI entry — and what `auth.ts` adds
  is a `beforeDelete` that takes the avatar off disk, the one thing a foreign
  key cannot reach. Everything else rides `onDelete: 'cascade'`, with `media`'s
  `created_by` and `list_items.added_by` staying deliberate `set null`s so
  leaving cannot take a shared catalog row with it.
- **The password, and nothing on top of it.** No "type your username to
  confirm" as well: the phone is already unlocked and already signed in, so what
  the sheet has to establish is that this is the account holder, which only the
  password does. Two rituals do not double the deliberation, they train people
  through both.
- **The demo instance is an offer, not a default.** The picker still never
  guesses — no default origin, no suggestion list — and the demo address is
  still probed before it is adopted, so a misconfigured build offers nothing
  rather than stranding whoever taps it. Unset is the default, and a
  self-hoster's build never sees the button.

One thing the environment decided rather than the plan: `expo install` could not
be used for the new native dependencies, because `api.expo.dev` was unreachable
from the build machine and that is where the SDK's version map lives. MMKV 4 and
its `react-native-nitro-modules` peer were therefore **pinned by hand** —
`~4.3.2` against `~0.35.10`, matching the nitro minor MMKV's nitrogen output was
generated against, which is the pairing the ABI cares about. `expo-doctor`'s two
network checks (the config schema and the React Native Directory metadata) are
skipped for the same reason, so the versions want a real device build behind
them before a release. `AGENTS.md`'s "let `expo install` choose" still stands;
this was a deviation under duress and is worth re-running when the API is
reachable.

## Verification

- `pnpm lint` / `pnpm typecheck` / `pnpm test` cover the app through the existing
  Turborepo fan-out; `expo-doctor` joins CI's `verify` job.
- Unit tests go in `apps/mobile/test/` mirroring `src/` (`AGENTS.md`), in a
  node-environment vitest project like `apps/web/vitest.config.ts` — the pure
  half only. Component and screen tests need a renderer and are out of scope
  here, exactly as they are on web.
- One test worth writing on day one: the **token drift guard** — parse the hex
  values out of `apps/web/src/styles.css` and assert `theme/tokens.ts` matches.
  Phase 4 adds its sibling: `test/lib/motion.test.ts` holds the swipe geometry
  and the four durations to §04 and §07. Same principle — the components that
  read them need a renderer, the numbers do not, and the numbers are what a
  redesign changes. Phase 5 adds the third of the family,
  `test/lib/offline.test.ts` — and it is the one that pays for the pattern. The
  queue's whole failure mode is silent: a `TrackingWrite` that does not survive
  `JSON.stringify`, or a `mutationKey` that resolves to no `mutationFn`, loses a
  check-in with nothing anywhere reporting it. Both are one assertion, and the
  optimistic-patch rules (the `completed`/`planned` sweep, the ADR-0007 stamping)
  come free with them now that `trackingPatch` is pure.
- Manual passes on a physical iOS and Android device against a local instance
  (the `start-app` skill brings the dev stack up; point the app at the LAN IP
  rather than `localhost`), and against a second instance to prove the picker.
  Two things only a device shows: haptics (a simulator rejects rather than
  no-ops) and the offline path, which needs a real radio to turn off — kill the
  connection, check in, kill the app, restore the connection, relaunch, and the
  check-in should be on the server without anyone tapping anything.
- Shipping has its own runbook: [`mobile-shipping.md`](mobile-shipping.md).
