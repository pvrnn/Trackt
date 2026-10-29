# ADR-0011: Feature gating through a code registry, a database rule and one server-side evaluator

**Status:** Accepted — 2026-10-29
**Touches:** ADR-0001/0002 (the instance owns its chrome, never the catalog), ADR-0008 (`/api/v1` is a contract with clients we do not control), PRD §7 (roles)

## Context

There was no way to release a feature gradually. Every surface shipped to every user of every instance at once, or waited behind a boot-time environment variable that needed a redeploy to change. Three release clocks already run independently: a self-host upgrades on the operator's schedule, the hosted instance deploys on every merge, and the mobile binary upgrades on the user's schedule and cannot be recalled.

A feature only safe for 10% of users, or only correct in one country, had no expression. A bad release could only be undone by another deploy.

The full design note — alternatives considered, the phases, the operator surface — is [`docs/feature-gating-plan.md`](../feature-gating-plan.md). This ADR records what was decided and built.

## Decision

1. **Keys and defaults live in code** (`packages/shared/src/flags.ts`), not in a table. The registry gives the API, web and mobile one typed key union, so a typo is a compile error and a flag dies with the feature it describes. Only two kinds are admitted: a **release flag** (`default: false`, rolled out, deleted after GA) and a **kill switch** (`default: true`, so an absent row, a dead `/v1/flags` and an old binary all keep the shipped feature).

2. **The database holds deviations only** (`feature_flag`, `feature_flag_override`, migration 0021). No row means the compiled default; a row carries the kill switch, a 0–100 rollout, an ISO country allowlist, an optional schedule and the last editor. A first write seeds `enabled`/`rollout` from the registry default, so adding a country rule to a dark release flag cannot switch it on.

3. **Evaluation is server-side only and has one implementation** (`apps/api/src/lib/flags.ts`): `env override > kill switch / schedule > per-user override > country > rollout`. The kill switch outranks a grant (an emergency must not be defeated by a QA override); a grant outranks the country allowlist (support has to be able to debug it). Percentage identity is `sha256("<flag>:<userId>") % 10000`, so a bucket is stable for life, independent per flag, and monotonic when a rollout widens. Clients receive booleans.

4. **`GET /v1/flags` is anonymous-readable and always lists every registry key.** It is per-viewer, so `private, max-age=0, must-revalidate` plus a weak ETag; a dead endpoint answers the compiled defaults on the client, never `false`. Closed gates answer `404` on the API, never `403` — do not advertise unreleased endpoints.

5. **Operators get three surfaces, one implementation:** `FEATURE_FLAGS="key=on|off|0-100"` (the emergency knob, wins in both directions), `PATCH/DELETE /v1/admin/flags` behind a reintroduced session-role guard, and `pnpm db:flag`. The admin read reports `source` (`default`/`db`/`env`) so a slider that does nothing says why.

6. **Country** comes from a trusted proxy header named by `FLAG_COUNTRY_HEADER`, then a fixed `FLAG_COUNTRY`; unknown fails closed for any non-empty allowlist. No GeoIP database and no third-party call on the request path: a spoofed header can grant early access, never data, and only a header your own edge sets should be named.

7. **The first consumer is the lists feature** (`lists.custom`, a kill switch, `default: true`). It gates the API routes, the web nav entry and both list pages, the media page's `＋ LIST` control, and the mobile profile row and list screens. Graded in at `default: true`, it changes no behaviour on merge; `db:flag -- lists.custom=off` removes the surface within the 5-second rule TTL without a deploy.

## Consequences

- A feature can ship dark, appear for a chosen percentage, and be killed in seconds, with no deploy after the first.
- Two sources of truth exist (code default, database rule). The single read module and the admin read's `source` field are the mitigation.
- Stale rules across replicas are bounded at 5s, not zero; an instant kill switch is `FEATURE_FLAGS` plus a restart.
- Percentage is not measurement: there is no analytics, so "rolled out to 10% and nobody complained" is the only signal. That is enough for releases and is why there are no variants.
- A flag is never an authorization primitive. Roles, media/list visibility and friendship rules stay authoritative; a gated-off feature that somehow renders must still fail its own permission check.
- A hidden flag still costs a slot: every registry entry names an owner and a `removeBy` date, and retirement is ordered (default → deploy, drop the row, delete the key and its branches).

## Not built

- The optional operator UI (`/admin/flags`) and `flags:audit` (phases 3–4 of the plan). The API, CLI and env override are the supported operator paths today.
- A/B variants, entitlements, central flag distribution and anonymous bucketing — deliberately out of scope, as the plan argues.
