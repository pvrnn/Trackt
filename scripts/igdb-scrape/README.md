# IGDB game seed scraper

Fetches IGDB games sorted by `total_rating` descending and writes the same general
seed-file layout used by the catalog scrapers. It uses IGDB's documented MCP
client (`uvx igdb-mcp-client`) and needs `uvx` on `PATH`.

```sh
# Default: the ~1,960 highest-rated games with at least 100 combined ratings
pnpm scrape:igdb

# Smaller run, a stricter rating-count cutoff, or a lower floor
pnpm scrape:igdb --limit 10 --min-rating-count 500 --out /tmp/games.json
```

Credentials are read from `~/.config/opencode/igdb.env` (`CLIENT_ID` and
`CLIENT_SECRET`), or from `IGDB_CLIENT_ID`/`IGDB_CLIENT_SECRET` environment
variables. The output path defaults to
`apps/catalog/seed/top-games-igdb.json`; that directory is gitignored because it
contains provider data intended for local seed/import workflows.

The file preserves the catalog seed row shape — one `kind: "game"` row per game,
canonical uuid derived from the IGDB id, with IGDB's own facts (`igdbType`,
`editionTitle`, `parentTitle`, `igdbStatus`, `platforms`, `igdbUrl`) in
`metadata` — so `apps/catalog` `db:seed` loads it as it stands. There are no
relation edges: this pass reads rankings, not a graph.

## Ranking

`total_rating` is an average, so it says nothing on its own about how much data
stands behind it: a game with ten ratings at 10/10 scores 100 and outranks
everything. IGDB holds ~12 200 games with ten or more ratings and ~1 960 with a
hundred or more, so the rating floor is what decides whether this seed is a
catalogue of games or a catalogue of one-off scores — the first 10 000-row run
had a 10-vote mod at number one, six and a half thousand rows under 50 votes, and
editions outranking their own base games.

The default floor is therefore 100 ratings and the default size is what that
floor yields. Release types that are not works a user tracks — `Mod`, `Fork`,
`Update`, `Episode`, `Season`, `Pack / Addon` — are dropped from the walk;
editions and DLC are kept, because search groups them under their parent game.
A run that stops because IGDB has no more eligible games writes what it found;
one that stops short with pages still full is refused rather than published.
