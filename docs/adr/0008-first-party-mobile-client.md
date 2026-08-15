# ADR-0008: A first-party mobile client (React Native + Expo)

**Status:** Proposed — 2026-08-15 (no code yet; the phased build is [docs/mobile-app-plan.md](../mobile-app-plan.md))
**Amended:** 2026-08-15 — the report/block consequence is closed; user-facing entry creation was withdrawn, and entry creation now happens only on the central catalog's publish path (PRD §3.5)
**Supersedes:** PRD §1 non-goals ("mobile native apps (PWA first)") and PRD §9's placement of mobile apps in v2
**Touches:** ADR-0001/0002 (the app is a client of an _instance_, never of the central catalog), ADR-0005 (news bodies are untrusted markdown on mobile too), ADR-0007 (the History year view is part of parity, and log dates are a mobile-native input)

## Context

`apps/web` is a TanStack Start PWA: installable on a phone, but it is a web app
wearing a home-screen icon. It gets no share sheet, no widget, no push, no
gesture-driven navigation, and its two signature interactions — the one-tap
check-in and the episode grid — are exactly the ones that want native touch
feedback.

The API was built for this from day one: `apps/api` is a standalone Fastify REST
service with an OpenAPI document, and every screen in `apps/web` is a thin
client of it (`apps/web/src/lib/` is fetch + Zod + React Query and touches the
DOM in exactly one file, `auth-client.ts` — still true across sixteen modules).
Nothing about the backend needs to change for a second client to exist — but
four things about _auth_, _addressing_, _distribution_ and _product surface_ do,
and they are the reason this is an ADR rather than a plan alone.

The deciding constraint is one Trackt does not share with a normal app: **there
is no "the server."** Every user is on someone's instance. A mobile client for a
self-hostable product is in the Mastodon/Jellyfin family, not the Letterboxd
family, and that shapes almost every decision below.

## Decision

1. **A first-party Expo app, in this repo, at `apps/mobile`.** Expo SDK 57 (React
   Native 0.86, React 19.2), expo-router for file-based routes, EAS for builds.
   It joins the pnpm/Turborepo workspace like any other app, so it consumes
   `@trackt/shared` as a workspace dependency and one `pnpm typecheck` covers it.

   In-repo rather than a separate repository because the app's contract _is_
   `packages/shared` — the Zod schemas that define every response are here, and
   a schema change that breaks the app should break the app's typecheck in the
   same PR. Metro has supported monorepos natively since SDK 52, and pnpm's
   isolated `node_modules` since SDK 54 (with `nodeLinker: hoisted` in
   `pnpm-workspace.yaml` as the documented escape hatch if a native dep resists).

2. **The app is instance-agnostic: the first screen is a server picker, not a
   login form.** There is no baked-in base URL and no default instance. The user
   types (or scans) an instance origin, the app probes `GET /healthz`, records
   the origin, and every subsequent request — API, `/api/auth/*`, `/uploads/*` —
   derives from it. Signing out returns to the picker; multiple accounts on
   multiple instances is the shape to build for even if v1 ships with one.

   Two consequences fall straight out:
   - **Every instance-relative path must be absolutized in one place.** The API
     returns `coverUrl` and avatar `image` as `/uploads/…` (see
     `apps/api/src/lib/uploads.ts`), which is same-origin on web and a broken
     image on mobile. One `resolveInstanceUrl()` helper owns this; nothing else
     concatenates. It is the mobile sibling of `apps/web/src/lib/url.ts`, which
     exists for the same class of bug on the other side (strings from outside
     becoming somewhere the client goes).
   - **The app must tolerate version skew.** A self-hoster on an old image will
     not have the newest endpoints — `GET /me/history` (ADR-0007) is three days
     old and `GET /media/showcase` is younger. `APP_VERSION` from `/healthz`
     gates any screen that needs a newer server, and unknown-enum tolerance
     follows the posture `federated-search.ts` already takes: skip the row,
     never fail the screen.

3. **Auth keeps better-auth, adding its Expo transport.** React Native has no
   cookie jar, so `@better-auth/expo` mirrors the session cookie into
   `expo-secure-store` and replays it as a `Cookie` header. That is a client
   concern plus **two server lines**: the `expo()` plugin in
   `apps/api/src/auth.ts`, and `trackt://` (plus `exp://` in development) added
   to `trustedOrigins`.

   `getSessionUser()` (`apps/api/src/lib/session.ts`) reads whatever headers
   arrive and is untouched, so **every route, visibility rule and role check
   works for the app on day one**. CORS is a browser mechanism and does not
   apply to native fetch; the production `origin: [APP_URL]` policy stays as-is.

   Rejected: a bearer-token/JWT plugin. It would introduce a second session
   representation for one client, and better-auth's Expo path already solves
   storage and refresh with the sessions we have.

4. **The data layer is extracted and shared; no UI is shared.** `apps/web/src/lib/`
   becomes `packages/client`: the Zod-validated fetch functions and React Query
   hooks, with the HTTP client and the session source **injected** rather than
   imported (web passes a same-origin `ky` instance and better-auth's React
   client; mobile passes an instance-URL-prefixed one and better-auth's Expo
   client). Query keys, the cache invalidation fan-out (`invalidateTracking`),
   the keyset `useInfiniteQuery` shape `news.ts` and `history.ts` share, the
   debounce threshold tuned to the API's 60/min search bucket, the generated
   cover gradients, `safeHref`, and the news markdown tokenizer live there once.
   The unit suite added in `apps/web/test/lib/` moves with them, which is most of
   the extraction's safety net.

   Components do not move. `GlassCard`, `Modal`, Radix — none of it exists in
   React Native, and pretending otherwise via a cross-platform component layer
   is how both clients end up mediocre. The rule is: **share everything below
   the render, share nothing above it.**

5. **AURA PRISM is ported as tokens, not as Tailwind classes.** `apps/mobile`
   gets a `theme/tokens.ts` transcribing `docs/design/README.md` — the same
   source of truth `apps/web/src/styles.css` cites — and styles with
   `StyleSheet`. NativeWind is deliberately not adopted: v4 pins Tailwind v3
   (a second Tailwind major in a v4 workspace), v5 is a pre-release, and the
   parity it would buy is smaller than it looks — the recipes that _are_ the
   design (fixed radial aura, grain overlay, `backdrop-filter` glass, PRISM
   gradient text, hover states) have no class form on either side and are
   rebuilt natively regardless: `react-native-svg` radial gradients, a tiled
   noise image, `expo-blur`, and `MaskedView` + `expo-linear-gradient`.

   The cost is drift between two token copies. Accepted, with a cheap guard: a
   test that parses the hex values out of `styles.css` and asserts `tokens.ts`
   matches.

6. **Motion is Reanimated 4, and no screen depends on shared-element
   transitions.** Reanimated 4 is stable on the New Architecture and brings
   declarative CSS-style animations alongside worklets; combined with the native
   stack it covers everything the design asks for (check-in tick, episode-tile
   fill, list reorder, sheet presentation). Shared-element transitions are
   available in 4.2+ but sit behind a feature flag and have a long tail of
   navigator-specific breakage — cover→hero may be _added_ as an experiment,
   never designed around. Reduced-motion is honoured, matching the PRD §6 rule
   the web app follows.

7. **Push notifications are out of scope for the first release.** They are the
   one feature the self-hosting model genuinely fights: Expo's push service (or
   raw APNs/FCM) needs credentials tied to the _app binary_, while the servers
   that would send them are thousands of independently-run instances. Doing it
   honestly means either a project-operated relay every instance opts into, or
   per-instance credentials most self-hosters cannot produce. Neither is worth
   blocking the app on, and the notification jobs do not exist server-side
   anyway (`apps/worker` has none). It belongs with the v1.x airing calendar,
   with its own ADR.

## Consequences

**The app forces four gaps in the product to close** — all of them real on web
too, none of them optional once there is a binary in a store:

- **Account deletion.** There is no `DELETE /me`. Apple requires in-app account
  deletion from any app that offers account creation, and it is the founding
  portability principle's missing half (we can export everything and erase
  nothing). This is the one blocker on submission that is pure backend work.
- ~~**Report / block.**~~ **Closed by removing the surface, 2026-08-15.** This
  ADR assumed the app would ship user-created catalog entries. Entry creation
  since moved to the central catalog's publish path, so nothing a user authors —
  beyond their own profile fields and list names — is visible to other users,
  and the store obligations that come with user-generated content (report path,
  block list, pre-publication filtering) do not attach. Revisit if comments
  land: they would reopen all three at once.
- **Pagination.** `GET /me/home` is a capped summary (12 in-progress rows) and
  `/search` maxes at 50. Mobile makes the missing **library endpoint** (already
  in the roadmap backlog) load-bearing. The pattern to copy now exists twice:
  `GET /news` and `GET /me/history` are both keyset-cursored (ADR-0005, ADR-0007).
- **Licensing vs. app stores.** The repo is **GPL-3.0-only**, and GPL terms have
  historically been held incompatible with the App Store's usage rules (VLC,
  GNU Go). This does not affect Android/F-Droid/APK distribution at all. As the
  copyright holder the project can resolve it for iOS — an App Store exception
  clause, or licensing `apps/mobile` permissively — but it is a decision to take
  deliberately, before writing the app, not after. **Not legal advice; get some.**

**And it changes how the API is versioned.** Today `apps/web` ships in the same
image as `apps/api`, so client and server are never out of step. An installed
app breaks that forever: from the first release, `/api/v1` is a contract with
binaries in the wild that upgrade on the user's schedule. Additive changes only,
enums parsed forward-compatibly, and `APP_VERSION` becomes something the client
actually reads.
