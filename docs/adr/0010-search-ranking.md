# ADR-0010: A flat, weighted search rank instead of a magnitude ladder

**Status:** Accepted — 2026-10-28
**Touches:** ADR-0002 (the merged result stream needs one comparable scalar `rank`), ADR-0003 (a franchise is many media rows, so a name query returns a family), `scripts/mal-scrape`'s `providerMetadata` (the `format` vocabulary)

## Context

Searching `re:zero` returned, in this order:

1. `Re:ZERO ~Starting Break Time From Zero~` — an 11-episode `tv short` spin-off, `providerScore` 65
2. `Re:ZERO -Starting Life in Another World-` — the series, `providerScore` 81

The complaint that surfaced it was the right one: the more popular work, in a main format, should be the answer to the franchise's own name.

The rank was a magnitude ladder:

```
CASE exact=5 | prefix=4 | substring=3 | synonym=2 | else=1  → × 1,000,000
+ GREATEST(similarity(title, q), similarity(synonyms, q))   → ×    10,000
+ providerScore                                             → ×        10
+ format bonus 0.05 … 0.01                                  → ×         1
```

Four problems, in order of consequence:

1. **Prefix-tier similarity decides a franchise query by title length.** Both rows prefix-match, so both take the same 4,000,000 tier, and the tiebreak is `similarity` over the *whole* string. Trigrams are diluted by every extra word, so the spin-off's shorter title scores 0.2424 against `re:zero` where the series scores 0.2051 — a 373-point edge that no other signal could challenge.
2. **`providerScore` was worth 0.1 of similarity.** 16 score points separate those two works; at ×10 that is 160 rank points against 373. Popularity was decorative, and the comment claiming "text match tier dominates provider score; format only breaks otherwise equal score ties" was describing a mechanism that could not do what it said.
3. **The `format` bonus never applied to the formats that needed it.** The `CASE` matched `'tv_short'` and `'one_shot'`; `providerMetadata` folds `_` to a space, so the stored values are `tv short` and `one shot`. The two branches were dead code, indistinguishable from a working bonus because both were ~0.
4. **The scale hid all of it.** A rank of `4,003,074.28` reads as a number nobody can reason about; the 0.05 that was supposed to break ties was five orders of magnitude below the term above it.

## Decision

1. **`rank` is `tier + text + formatClass + popularity`, and the three weights sum to 0.95.** The tier is the integer part (5 exact, 4 prefix, 3 substring, 2 synonym substring, 1 similarity-only), so the string match remains strictly dominant but the sub-signals are legible numbers in `[0, 1)`.

2. **Text relevance stays the primary in-tier signal — weight 0.60.** Whole-title (or synonym blob) trigram similarity, as before. This is what keeps an explicit query finding the explicit work: `re:zero season 2` must still find that season, and it is also what keeps the original series ahead of its better-rated seasons without needing a "root work" signal the data cannot yet support.

3. **Format class — weight 0.20 — applies only where the query names a work, i.e. the exact and prefix tiers.** Several rows sharing a title or starting with the query means the query is a franchise name; there, a main format outranks a derived one by a fixed 0.20 (0.33 of similarity), enough to beat the trigram advantage of a short title. Anywhere else the query is a *description* — "break time" — and a short that matches it best is the right answer, so the class is not applied at all. The derived vocabulary is listed explicitly (`tv short`, `special`, `ova`, `music`, `pv`, `cm`, `one shot`), with the space-separated spelling the importers actually write; **anything not listed counts as a main work**, because demoting an unfamiliar vocabulary is a guess, and TMDB rows carry no `format` at all. `ona` is deliberately main: web-first originals such as Cyberpunk: Edgerunners release as ONA.

4. **Popularity — weight 0.15 — is `providerScore / 100`, with a neutral 0.5 for rows that publish no score.** 0.15 is worth 0.25 of similarity: enough to separate adjacent seasons and equally-relevant rows, not enough to let a better-rated sequel overtake the original. Neutral, rather than 0, so "unknown" does not read as "bad" and systematically bury every TMDB-sourced series behind every scored AniList one.

5. **The weights and the vocabulary live in `packages/shared/src/search-rank.ts`.** The two services keep their own SQL — they read different tables with different visibility rules, and a shared SQL builder would put a drizzle dependency (or `packages/db`) into the catalog image, which ADR-0001's build graph deliberately keeps out. The numbers, which are what actually drift, are shared; both integration suites pin the ordering that the numbers produce.

6. **No season/relation signal yet.** `season_number` looks like the natural "this is the original" flag, but it is not trustworthy in the AniList seed: `Re:ZERO … Season 2` and `Season 3` both carry `season_number = 1` (their sequel edges never made it into the seed) while `Season 4` carries `5`. Ranking on it would push Season 4 below Season 2 for a reason that is a data bug, not a ranking judgement.

## Consequences

Measured on the dev catalog (`q=re:zero`, both rows prefix tier):

| title | text | format | popularity | rank |
|---|---|---|---|---|
| `Re:ZERO -Starting Life in Another World-` (`tv`) | 0.2105 | 1 | 0.81 | **4.4478** |
| `… Season 4` (`tv`) | 0.1702 | 1 | 0.90 | 4.4371 |
| `… Season 3` (`tv`) | 0.1702 | 1 | 0.84 | 4.4281 |
| `Re:ZERO ~Starting Break Time From Zero~` (`tv short`) | **0.2424** | **0** | 0.65 | 4.2429 |

- The reported ordering is fixed: the series leads, its seasons follow, the spin-off drops below all of them. `re:zero break time` still returns the spin-off first (its text match is unambiguous and the class is not applied outside the naming tiers), and an exact match still outranks a more popular prefix match, because the tier cannot be crossed.
- Across a 15-query spot check (`attack on titan`, `berserk`, `jujutsu kaisen`, `one piece`, `spy x family`, `the witcher`, …) the outside changes are small and in the expected direction: derived rows drop below main works inside a franchise family (`attack on titan`'s OVA leaves the top five, `gundam`'s `Gundam Evolve` leaves the top five, `naruto`'s `one shot` and `NARUTO×UT` OVA fall behind `Shippuden`, `fate`'s `one shot` leaves it). Queries that are already unambiguous, such as `one piece` and `berserk`, do not move at all.
- `rank` remains an internal merge key: nothing renders it, and `apps/api`'s federated merge only compares it (`b.rank - a.rank`, title then id on ties). Changing its scale is not a contract change; changing its *ordering* is.
- Known limits, deliberately not addressed here:
  - **Descriptive multi-word queries are still weak.** `re:zero season 2` returns *Fate/Zero Season 2* first: no Re:ZERO title contains that phrase, so the trigram gate admits other `… zero season 2` titles and the Re:ZERO row never competes. The fix is token coverage (every query word must appear in the title) rather than another weight.
  - **`providerScore` is not comparable across sources** — AniList `averageScore` and IGDB `total_rating` come from different populations. It is now worth 0.25 of similarity, so the open question in `docs/ROADMAP.md`'s backlog (normalize per source, surface the source, or drop it) matters more than it did.
  - **A fourth signal would want the SQL to stop being duplicated.** If one arrives, extract the expression into `packages/shared` as a function taking the caller's `sql` tag and column refs, instead of a third copy.
  - **Exact ties are arbitrary.** `SPY x FAMILY` is both a manga and a TV season at `providerScore` 83; both land on the same rank and the order falls to `title`, then `id`, so a UUID decides which one leads. Both formats are main, so the format class cannot separate them — a kind preference or a "season row" hint would.
