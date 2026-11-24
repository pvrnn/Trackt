# Catalog research pass — agent brief

You are auditing pairs of works in Trackt's central catalog and deciding whether
they are related. Trackt is a tracker for movies, series, anime, manga and games.
The catalog is built from five provider seeds in `apps/catalog/seed/`:

| seed                     | kind(s)                             | who provides it |
| ------------------------ | ----------------------------------- | --------------- |
| `top-anime-anilist.json` | anime, plus the manga it relates to | AniList         |
| `top-manga-anilist.json` | manga, plus the anime it relates to | AniList         |
| `top-games-igdb.json`    | game                                | IGDB            |
| `top-movies-tmdb.json`   | movie                               | TMDB            |
| `top-series-tmdb.json`   | series (one row **per season**)     | TMDB            |

Each provider is a closed graph. AniList links anime↔manga; nothing links a film
to the game it adapts, a show to the manga it came from, or a remake to its
original. That gap is what this pass fills — and it is also the pass where wrong
links do the most damage, because a relation renders as a shelf on the work's
page and a false "adaptation" is a false claim about authorship.

You have one batch of **100 candidates** in
`apps/catalog/seed/research/batches/batch-NNN.json`. Each candidate is a pair of
rows (different kinds) that share a normalised title or synonym and have no edge
yet. Work through them **one at a time, in order**.

---

## Per candidate, do three things

### 1. Decide: are these two works actually related?

Two rows sharing a title are very often **not** related — "Home", "Alone",
"Monster" and "Fate" are names several unrelated works use. Compare year, kind,
country, creators and synopsis. A pair is a homonym unless a source shows one
work's existence is tied to the other (same source material, same continuity,
one spun off the other).

**Reject** the pair when it is a homonym, or when you cannot verify it.

When the two rows are **two adaptations of one third work** (a manga and its
anime and its live-action film; two different anime of one manga), do **not**
emit `adaptation` in either direction — neither is the other's source. Emit
`related`, `confidence: medium`, and name the shared source in `reason`
("Both adapt <source>; neither adapts the other"). `related` is symmetric and
true, and it is the edge that lets a reader jump from the manga to the film.
The exception is a _re-adaptation of the same screen work_ (a remake film of a
film): that stays `rejected` unless a source ties the two productions, because
sharing a source is not the same as sharing a franchise.

If the two rows are **the same work twice**, reject the pair and say so with the
typed `duplicate` field (`keepId`, `dropId`, `note`, `source`). This is a real
defect — TMDB files a long-running Chinese donghua as one giant season while
AniList has one row per season, so the catalog carries one work twice. Pick the
row that should survive: the one whose provider is native to the kind (AniList
for anime/manga, IGDB for games, TMDB for films and Western series) and whose
episode/chapter count matches the provider. `duplicates.json` is built from
these and drives a separate fold; it is never an edge.

### 2. If related, classify the edge — direction matters

Edges are stored **forward** and the direction is part of the claim
(`packages/shared/src/media.ts`):

- `A --adaptation--> B` means **B adapts A**. The source material is `fromId`.
  - manga → anime: `manga --adaptation--> anime`
  - manga → live-action film: `manga --adaptation--> movie`
  - game/visual novel → anime: `game --adaptation--> anime`
  - novel → film: the novel usually is not in the catalog; if it is not, link
    nothing (you may only use the two candidate rows).
- `A --sequel--> B` means **B is A's sequel**.
- `A --spinoff--> B` means **B spins off A**.
- `related` is symmetric and the weakest true claim: same franchise/continuity,
  a remake, a recap film, a re-adaptation of the same source, an "inspired by"
  the publisher itself states. Emit it **once**.

Do not upgrade: a remake is `related`, not `adaptation` (its source is a film,
not a book). A recap/compilation film of a series is `related`. A same-name film
and show with no shared production is a homonym: reject, do not `related` it.

State the evidence honestly as `confidence`:

- `high` — a source says it outright: "is an adaptation of", "based on the manga
  by", AniList `relationType: ADAPTATION`, IGDB "based on the film".
- `medium` — strongly implied: listed as a spin-off by the publisher, the same
  creators state the tie, the game's synopsis continues the film's story.
- `low` — circumstantial: same launch window, same lead actors, same studio, but
  no source states the relationship. Low links are **held back for review**
  rather than published, so say `low` instead of dropping the candidate or
  overstating it.

### 3. Audit both rows' data and propose corrections

Candidates are exactly the rows where cross-provider facts disagree, so check:

| field         | what "wrong" looks like                                                                                                                                                                |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `year`        | a year off from the provider (release vs production, season vs show)                                                                                                                   |
| `partCount`   | episode/chapter count off; **series rows are one season** — the count is that season's episodes, never the show's                                                                      |
| `status`      | finished work marked `airing`/`publishing`, or the reverse                                                                                                                             |
| `genres`      | empty, or a leaked slug (`role-playing-rpg`, `sci_fi`), or a tag no other row of that kind uses                                                                                        |
| `synonyms`    | no English/French/Spanish title where one exists; keep at most 6, latin script only                                                                                                    |
| `description` | empty, or the blurb of a _different_ work                                                                                                                                              |
| `externalIds` | `imdb`/`tmdb`/`mal`/`anilist`/`igdb`/`steam`/`tvdb` you can state from a provider                                                                                                      |
| `metadata.*`  | missing `runtime`/`volumes`/`episodes`-ish count/`providerScore`/`releaseDate`/`airDate`/`studios`/`networks`/`directors`/`creators`/`platforms`/`igdbUrl` that the provider publishes |

Genres must reuse the existing vocabulary — `apps/catalog/seed/research/genre-vocabulary.txt`
lists every tag in use per kind, with counts. Never invent a spelling
(`science fiction`, not `sci-fi`; `role playing`, not `rpg`).

Two deliberate conventions that look like errors and are not:

- a running manga or anime is `status: "airing"` — the AniList importer maps its
  `RELEASING` state to `airing`, so `publishing` is wrong here even for print;
- `metadata.lastAirDate` on a _series_ row is the show-level date by design
  (`scripts/tmdb-scrape/series.ts`), not the season's last episode.
  Only edit either when the value contradicts its own provider.

**Never edit**: `id`, `kind`, `seasonNumber`, `title`, `externalIds.<own provider>`
(movie/series → `tmdb`, anime/manga → `anilist`, game → `igdb`; editing it
invalidates the canonical UUID and the seeder drops the row), the `metadata`
object as a whole (edit `metadata.<key>`). The validator enforces this.

Edits need a `source` URL that states the value. Do not "fix" a value because it
looks unfamiliar — provider vocabulary differs on purpose.

---

## Research toolkit

Cheapest first. Cite the URL you actually read in `evidence`.

**Wikipedia** (keyless, best for "X is an adaptation of Y"):

```sh
curl -s "https://en.wikipedia.org/api/rest_v1/page/summary/Monster_(manga)" | head -c 2000
curl -s "https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=steins%3Bgate+visual+novel&format=json" | head -c 3000
```

**TMDB** (movies + series, also gives imdb/tvdb ids):

```sh
set -a; . ~/.config/opencode/tmdb.env; set +a
curl -s "https://api.themoviedb.org/3/search/movie?query=monster&year=2003" -H "Authorization: Bearer $TMDB_READ_ACCESS_TOKEN"
curl -s "https://api.themoviedb.org/3/search/tv?query=monster" -H "Authorization: Bearer $TMDB_READ_ACCESS_TOKEN"
curl -s "https://api.themoviedb.org/3/movie/157336?append_to_response=credits,external_ids" -H "Authorization: Bearer $TMDB_READ_ACCESS_TOKEN"
```

**AniList** (anime + manga, declares `relations` with `relationType: ADAPTATION`):

```sh
curl -s -X POST https://graphql.anilist.co -H 'content-type: application/json' \
  -d '{"query":"query($id:Int){Media(id:$id){id idMal format episodes chapters volumes startDate{year month day} relations{edges{relationType node{id idMal format title{romaji english} startDate{year}}}}}}","variables":{"id":19}}'
```

Search variant: `Media(search:"steins gate", type:ANIME){...}`. Rate limit 90/min.

**TMDB keywords — the cheapest signal for drama↔comic pairs.** One request:

```sh
curl -s "https://api.themoviedb.org/3/tv/1399/keywords" -H "Authorization: Bearer $TMDB_READ_ACCESS_TOKEN"
```

A `based on manga`, `based on webcomic or webtoon`, `based on novel`, `based on comic book`
keyword settles in one call what a Wikipedia search may not state at all. Also use
`/movie/{id}/external_ids` and `/tv/{id}/external_ids` for the imdb/tvdb ids.

**IGDB** — the Twitch credentials in `~/.config/opencode/igdb.env` are revoked; if
an `igdb` MCP tool is present use `search`/`get_details` on entity `game`,
otherwise fall back to Wikipedia/MobyGames for game facts.

**Web search**: the `websearch` tool, for anything the above miss.

Budget: **≤ 4 HTTP requests and ~2 minutes per candidate**. Inconclusive after
that → reject with reason `unverified`. Precision beats coverage: a rejected real
pair costs nothing (the next pass re-proposes it), a false link ships to users.

---

## Output

Write exactly one file: `apps/catalog/seed/research/results/batch-NNN.json`
(use the batch's own number). Then validate it:

```sh
node scripts/catalog-research/check.mjs apps/catalog/seed/research/results/batch-NNN.json
```

Shape — one verdict per candidate, `n` from the batch, **all 100 answered**:

```json
{
  "batch": "batch-001",
  "verdicts": [
    {
      "n": 1,
      "pairKey": "<left.id>|<right.id>",
      "verdict": "linked",
      "reason": "TV anime adapts the 2009 Nitroplus visual novel (same writer).",
      "link": {
        "fromId": "<game id>",
        "toId": "<anime id>",
        "type": "adaptation",
        "confidence": "high",
        "source": "https://en.wikipedia.org/wiki/Steins;Gate"
      },
      "evidence": ["https://en.wikipedia.org/wiki/Steins;Gate"],
      "metadata": [
        {
          "id": "<anime id>",
          "path": "externalIds.mal",
          "to": 9253,
          "source": "https://graphql.anilist.co  (idMal)",
          "note": "optional"
        }
      ]
    },
    {
      "n": 2,
      "pairKey": "<left.id>|<right.id>",
      "verdict": "rejected",
      "reason": "Homonym: 2015 US comedy film vs 2024 French series, no shared production.",
      "evidence": ["https://www.themoviedb.org/movie/...", "https://www.themoviedb.org/tv/..."]
    },
    {
      "n": 3,
      "pairKey": "<left.id>|<right.id>",
      "verdict": "rejected",
      "reason": "Same work twice: TMDB's single 264-episode season is AniList's season 1.",
      "duplicate": {
        "keepId": "<anilist row id>",
        "dropId": "<tmdb row id>",
        "note": "AniList row counts episodes per season; the TMDB row aggregates all of them.",
        "source": "https://anilist.co/anime/..."
      },
      "evidence": ["https://www.themoviedb.org/tv/.../season/1", "https://anilist.co/anime/..."]
    }
  ]
}
```

`duplicate` is only valid on a `rejected` verdict, and either id may be the one
dropped. `metadata` is optional and may be omitted or empty. `pairKey` is in the
batch as `<left.id>|<right.id>` — copy it verbatim (it is sorted, so it may not
read left-then-right).

Do not edit the seeds, the batches, or the scripts. Do not run
`merge.mjs`. Your only write is your result file.
