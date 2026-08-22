# Shipping the mobile app

The runbook for `apps/mobile` — build profiles, store submission, and the four
things a store forces that the app itself does not. Companion to the
[mobile plan](mobile-app-plan.md)'s phase 5; the plan says _what_ was built, this
says _how it goes out_.

Nothing here is needed to run the app against your own instance. `pnpm --filter
@trackt/mobile dev` and a dev client cover that, and a self-hoster who builds
their own APK needs only the `preview` profile below.

## Build profiles (`apps/mobile/eas.json`)

| Profile       | What it is                                                                       | Distribution                          |
| ------------- | -------------------------------------------------------------------------------- | ------------------------------------- |
| `development` | A dev client — Metro attaches to it, so JS changes reload without a rebuild       | internal; iOS simulator, Android APK  |
| `preview`     | A release build that is not a store build. What a self-hoster wants               | internal; Android APK, ad-hoc iOS     |
| `production`  | The store build, `autoIncrement` on remote version source                         | store; Android App Bundle             |

All three extend a `base` profile that pins Node 22 (matching `engines`) — a
build that resolves a different major than CI is a build whose lockfile means
something else.

`appVersionSource: "remote"` means EAS owns the build number and
`app.config.ts`'s `version` stays the marketing version. Do not bump build
numbers by hand.

### First run

`eas.json` is complete except for the things that only exist once an EAS project
does. On the first `eas build`, `eas init` writes `extra.eas.projectId` into the
app config; nothing else in the repo needs to change.

**EAS Update is declared but not wired.** Each build profile names a `channel`,
which is the half of the binding that lives in this repo. The other half —
`expo-updates`, `updates.url` and a `runtimeVersion` policy — is written by `eas
update:configure`, and `updates.url` embeds the project id, so it cannot be
committed ahead of one. Running that command is the last step of the first
release, not a change to make now: a half-configured `expo-updates` in a build
is worse than none.

## Store submission

`eas submit --profile production` for both platforms. The Android half is
configured (internal track, draft status — a submission still has to be
promoted by hand). The iOS half is not: `ascAppId` and `appleTeamId` are account
identifiers, `eas submit` prompts for them on first use and stores them, and
committing them here would put an Apple team id in a public repo for no benefit.

### The licence question

Answered in phase 0, and it is why an iOS build is possible at all:
[`LICENSE.exceptions`](../LICENSE.exceptions) grants, under GPLv3 §7, permission
to distribute the mobile binary through app stores whose terms conflict with
§§4–6. The GPL text itself is unmodified and the source stays GPL-3.0-only.
Android and F-Droid were never affected.

### Privacy

The store listing needs a privacy policy at a public URL.
[`docs/mobile-privacy.md`](mobile-privacy.md) is that policy. It is short for a
real reason: the app has no backend of its own, so almost every question a
privacy nutrition label asks is answered by "whichever instance you chose", and
saying so precisely is more honest than a page of boilerplate about a data
controller that does not exist.

What the label itself should say: **no data collected by the developer**. The
app talks to one server, the user names it, and nothing is sent anywhere else —
there is no analytics SDK, no crash reporter, and no ad identifier in the
dependency tree.

### Account deletion

App Store guideline 5.1.1(v) requires an account created in the app to be
deletable in the app. `DELETE /api/v1/me` is that (mobile plan phase 5), reached
from **Profile → Account → Delete account**, and it is also the missing half of
the portability principle — an instance you can export from but never leave is
not self-hosting.

Point a reviewer at it explicitly in the review notes; it is the last control on
the profile screen, deliberately quiet, and it is easy to miss.

### The demo instance (guideline 4.2)

A reviewer has no Trackt instance, and an app whose first screen asks for a
server address reads as "minimum functionality" with nothing behind it. So a
build may be given one:

```sh
TRACKT_DEMO_INSTANCE=https://demo.trackt.example eas build --profile production
```

That address lands in `extra.demoInstance`, and the picker grows a **Use the
demo instance** button — only then. Unset, which is the default and what a
self-hoster's build will be, the picker is exactly what it was: no default
origin, no suggestion list. The address is still probed before it is adopted, so
a misconfigured build offers nothing rather than stranding whoever taps it.

The instance behind it needs a demo account whose credentials go in the review
notes, and enough tracked history that Home, History and Profile are not empty
screens. It is not otherwise special: it is an ordinary Trackt deployment.

## What is not blocking any more

- **A keyset library endpoint.** The mobile plan listed this as a gap. It is
  closed: `GET /v1/me/history` (ADR-0007) is keyset-paged over the whole tracked
  collection, and ALL TIME with no filters _is_ the library. The ROADMAP records
  the same supersession.
- **Report/block.** Entry creation moved to the central catalog, so the app
  carries no user-authored titles or covers. Profile fields and list names are
  still user-supplied — worth revisiting if comments ever land.

## Before a release

The four repo checks, plus the app's own:

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm format:check
pnpm --filter @trackt/mobile doctor
```

Then a manual pass on a physical device of each platform against a local
instance — the `start-app` skill brings the dev stack up, and the app points at
the LAN address. Two things only a device tells you: haptics (a simulator
rejects rather than no-ops) and the offline path, which needs a real radio to
turn off.
