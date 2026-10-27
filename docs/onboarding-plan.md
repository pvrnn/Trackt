# Plan — onboarding, interests, and guided tours

> **Status:** Proposed. This plan covers a post-sign-up setup flow, persistent media-kind
> preferences, and optional page-by-page product tours. The roadmap records implementation
> status; this document is the feature plan.

## Goal

Help a new user get to a useful, personal Trackt experience without making setup a gate. After
creating an account, users can find friends, optionally connect Discord, choose which media kinds
they care about, then learn the app through dismissible tips on the relevant pages. Their selected
interests personalize Discover and News by hiding kinds they do not want to see.

## Experience

### 1. First-run setup after registration

Show a short, resumable onboarding flow after successful account creation. It has a clear progress
indicator, Back/Continue controls, and **Skip for now** on every optional step. Completion or skip
must not block access to the app. Returning users who leave midway resume at the next incomplete
step; a user can later edit preferences from their profile/settings.

Suggested order:

1. **Welcome** — explain that Trackt tracks movies, series, anime, manga, and webtoons; set
   expectations and let the user start or skip setup.
2. **Find friends** — reuse the existing user search and friend-request flow. Explain that a request
   must be accepted before someone is a friend. Allow skipping without creating any relationship.
3. **Connect Discord (optional)** — offer account linking, explain exactly what connecting enables,
   and provide a clear not-now path. Do not require Discord to use Trackt.
4. **Choose your interests** — select any combination of movies, series, anime, manga, and webtoons.
   Explain that unselected kinds are filtered from Discover and News, not deleted or untracked.
   Provide an obvious “show all” / select all action.
5. **Finish** — confirm the choices and go to Home (or the user's intended destination).

Keep each step short and usable on narrow screens. If setup is interrupted, preserve completed
choices; do not make users repeat a successful friend request or Discord authorization.

### 2. Guided page tours

After setup, introduce key pages with contextual tooltips anchored to real controls: Home, Discover,
media detail, News, Profile, Lists, History, and Friends. A tour explains one concept at a time and
offers **Continue**, **Back** where applicable, and **Skip tour**. Completing or skipping a tour
never disables the underlying page. Tours should start only when useful (for example, first visit),
avoid covering the control being explained, and work with keyboard navigation and screen readers.

Store tour progress per user so a dismissed tour does not reappear on every visit. A user should be
able to replay tours from a help/onboarding entry point. Keep the tour framework data-driven so
copy and anchors can change with the UI without a separate bespoke flow per page.

## Preferences and filtering

- Persist the selected media kinds as **user-owned profile preferences**, not browser-only state,
  so choices follow the account across web/mobile sessions and devices.
- The supported values match the existing `MediaKind` vocabulary: `movie`, `series`, `anime`,
  `manga`, `webtoon`.
- Define the meaning consistently: selected kinds are shown; unselected kinds are hidden from
  personalized Discover and News surfaces. Filtering affects presentation only — it must not
  change search results, tracking history, profile shelves, friend activity, or saved lists.
- Apply the preference to Discover results and News feed/article recommendations or linked-media
  surfaces as appropriate. For a News article associated with both selected and unselected works,
  define whether it remains visible when at least one linked kind is selected; default proposal:
  show it if at least one linked media item matches, and retain editorial items with no linked media.
- Keep explicit kind filters usable. A user must be able to temporarily include an otherwise hidden
  kind, and the UI should indicate when preferences are filtering results with a quick “show all”
  affordance.
- If the user has selected no kinds (for example, skipped the step), treat that as **all kinds**,
  not an empty Discover/News page. Persist an explicit “all” state or define empty selection as all
  consistently; do not infer preferences from whether onboarding was completed.
- Anonymous visitors and signed-out users have no personal preference and see all kinds. On a
  self-hosted instance, retain sensible behavior if user preferences cannot be loaded: fail open to
  all kinds rather than hiding content unexpectedly.

## Discord linking and friend-list sharing

Discord linking and sharing are separate choices. Linking proves control of a Discord account; it
does **not** silently import contacts or expose the Trackt friend list. Before sharing, explain what
will be shared, with whom, and how to revoke it. The user must explicitly opt in, and must be able to
disconnect or stop sharing later.

Before implementation, settle the product contract for “share friend list”: whether this means
sharing a Trackt profile/link through Discord, matching Discord contacts to Trackt accounts, or
publishing the Trackt friend list to Discord. These have materially different privacy and bot/API
requirements. The safest initial scope is account linking plus an explicit share action that posts a
user-controlled Trackt profile/invite link; do not read Discord guild membership or publish a list
without a separate consent and privacy design.

## Data and API design (to validate during implementation)

- Add a user preference record/fields for selected kinds and onboarding completion/version. Keep
  preferences separate from public profile data; they are private account settings.
- Represent Discord as a linked identity with provider subject ID and timestamps, not as a password
  or a copied Discord token. Store only the minimum data needed, encrypt secrets if any are required,
  and support unlinking. Never expose Discord credentials in profile/API responses.
- Add authenticated read/update endpoints for preferences and linking state, reusing the shared
  Zod-schema / client-query-key conventions. Avoid changing existing anonymous public profile data.
- Prefer server-side filtering for personalized feeds where it preserves pagination and result
  counts; otherwise filter before rendering and ensure pagination does not produce sparse pages.
  Discover's shareable kind query parameter should continue to work and compose predictably with
  the saved preference.
- Treat the onboarding version as a migration trigger for future new-user steps, not a reason to
  force existing users through onboarding again.

## Delivery phases

1. **Product and privacy contract:** decide the precise Discord sharing behavior, preference
   visibility, News mixed-link rule, and whether settings live in Profile or a dedicated Settings
   page. Confirm web/mobile parity expectations.
2. **Preference foundation:** schema + migration, shared types/schemas, API, client hooks, profile
   settings UI, and tests. Default to all kinds for existing accounts and anonymous traffic.
3. **Feed personalization:** apply preferences to Discover and News, reconcile with explicit filters
   and pagination, and test logged-in, anonymous, empty-preference, and override cases.
4. **Post-sign-up flow:** add resumable welcome/friends/Discord/interests/finish steps. Reuse existing
   friend search and request actions; keep all optional actions skippable and idempotent.
5. **Tours:** build the accessible tooltip-tour primitive and introduce tours incrementally on the
   agreed pages. Add replay controls and per-user completion state.
6. **Discord integration:** implement only after the linking and sharing contract is approved;
   add consent, revoke/unlink, failure recovery, and security tests.

## Acceptance criteria

- A new user can finish, skip, or leave setup and still use the app; progress resumes without
  repeating completed side effects.
- Friend discovery uses the existing request/accept model; no friend is added without consent.
- Discord linking is optional and does not imply friend-list access or sharing.
- A user can choose any supported media-kind combination, change it later, and see the preference
  applied consistently on Discover and News across sessions.
- Hidden kinds are not removed from search, history, profile, lists, or existing tracking data;
  explicit user filters can reveal them temporarily.
- Every page-tour step can be continued or skipped, is accessible, and never leaves a dead or
  blocked control behind.
- Existing accounts, signed-out visitors, and self-hosted deployments without Discord configuration
  continue to work with all kinds visible and no Discord dependency.

## Open questions

1. What exactly should “share friend list” do: invite/share a profile, discover Discord contacts,
   or publish a list of Trackt friends?
2. Should preference selection default to all kinds with opt-out, or require an explicit choice while
   treating skip as all? (Recommended: all by default, explicit opt-out.)
3. Should tours be one global sequence or independently offered per page? (Recommended: page-scoped,
   with a global skip and replay entry point.)
4. Where should users edit onboarding choices after setup: Profile, Settings, or both?
