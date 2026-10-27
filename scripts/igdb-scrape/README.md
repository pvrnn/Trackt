# IGDB game seed scraper

Fetches IGDB games sorted by `total_rating` descending and writes the same general
seed-file layout used by the catalog scrapers. It uses IGDB's documented MCP
client (`uvx igdb-mcp-client`) and needs `uvx` on `PATH`.

```sh
# Default: 10,000 highest-rated games with at least 10 combined ratings
pnpm scrape:igdb

# Smaller run or a stricter rating-count cutoff
pnpm scrape:igdb --limit 10 --min-rating-count 100 --out /tmp/games.json
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
Ranking uses IGDB `total_rating`; the default ten-rating minimum leaves enough
eligible records for a 10,000-row seed while filtering out one-off score outliers.
