/** Build an IGDB-ranked game seed in the same row shape as the catalog seeds. */

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const NAMESPACE = 'f8d11238-d681-551c-875d-5ac53892f6e7';
const PAGE_SIZE = 100;
const DETAIL_BATCH_SIZE = 100;

/**
 * IGDB `game_type` ids that are not works a user tracks: modifications, forks,
 * patches, episodic slices, seasons and add-on packs. They carry their own
 * rating populations and would otherwise outrank real games — the 10k seed this
 * replaces had a 10-vote mod at number one.
 */
const NON_WORK_GAME_TYPES = new Set([5, 6, 7, 12, 13, 14]);

type Args = { limit: number; minRatingCount: number; out: string };
type IgdbGame = {
  id: number;
  name: string;
  total_rating?: number;
  total_rating_count?: number;
  first_release_date?: number | string;
  summary?: string;
  url?: string;
  slug?: string;
  genres?: number[];
  platforms?: number[];
  cover?: number;
  game_type?: number;
  game_status?: number;
  release_dates?: number[];
  parent_game?: number;
  version_parent?: number;
  version_title?: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    // IGDB has ~1 960 games with at least 100 ratings; a vote floor low enough
    // to yield 10 000 rows is a floor of 10, and the ranking it produces is
    // one-off scores, editions and mods rather than games.
    limit: 2_000,
    minRatingCount: 100,
    out: 'apps/catalog/seed/top-games-igdb.json',
  };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i + 1];
    if (argv[i] === '--limit' && value) {
      args.limit = Number(value);
      i++;
    } else if (argv[i] === '--min-rating-count' && value) {
      args.minRatingCount = Number(value);
      i++;
    } else if (argv[i] === '--out' && value) {
      args.out = value;
      i++;
    } else if (argv[i] === '--help') {
      console.log('Usage: pnpm scrape:igdb [--limit 2000] [--min-rating-count 100] [--out path]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100_000) {
    throw new Error('--limit must be an integer from 1 to 100000');
  }
  if (!Number.isInteger(args.minRatingCount) || args.minRatingCount < 0) {
    throw new Error('--min-rating-count must be a non-negative integer');
  }
  return args;
}

async function credentials(): Promise<{ clientId: string; clientSecret: string }> {
  const values: Record<string, string> = {};
  const envFile = resolve(homedir(), '.config/opencode/igdb.env');
  try {
    for (const line of (await readFile(envFile, 'utf8')).split(/\r?\n/)) {
      const match = line.match(/^\s*(CLIENT_ID|CLIENT_SECRET)\s*=\s*['"]?([^'"#]*)['"]?\s*$/);
      if (match) values[match[1]!] = match[2]!.trim();
    }
  } catch {
    // Environment variables are also supported for CI and other machines.
  }
  const clientId = process.env.IGDB_CLIENT_ID ?? process.env.CLIENT_ID ?? values.CLIENT_ID;
  const clientSecret =
    process.env.IGDB_CLIENT_SECRET ?? process.env.CLIENT_SECRET ?? values.CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(`Set IGDB_CLIENT_ID/IGDB_CLIENT_SECRET or configure ${envFile}`);
  }
  return { clientId, clientSecret };
}

class IgdbMcp {
  private readonly child;
  private buffer = '';
  private nextId = 0;
  private readonly pending = new Map<number, (message: Record<string, unknown>) => void>();

  constructor(clientId: string, clientSecret: string) {
    this.child = spawn('uvx', ['igdb-mcp-client'], {
      stdio: ['pipe', 'pipe', 'ignore'],
      env: { ...process.env, CLIENT_ID: clientId, CLIENT_SECRET: clientSecret },
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      for (
        let newline = this.buffer.indexOf('\n');
        newline >= 0;
        newline = this.buffer.indexOf('\n')
      ) {
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        try {
          const message = JSON.parse(line) as Record<string, unknown>;
          const id = message.id;
          if (typeof id === 'number') {
            this.pending.get(id)?.(message);
            this.pending.delete(id);
          }
        } catch {
          // Ignore non-JSON stdout from the MCP launcher.
        }
      }
    });
    this.child.on('exit', (code) => {
      for (const resolveMessage of this.pending.values()) {
        resolveMessage({ error: { message: `IGDB MCP process exited (${code})` } });
      }
      this.pending.clear();
    });
  }

  private request(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const id = ++this.nextId;
    return new Promise((resolveMessage, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`IGDB MCP request timed out: ${method}`));
      }, 60_000);
      this.pending.set(id, (message) => {
        clearTimeout(timeout);
        resolveMessage(message);
      });
      this.child.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`,
        (error) => {
          if (error) {
            clearTimeout(timeout);
            this.pending.delete(id);
            reject(error);
          }
        },
      );
    });
  }

  async start(): Promise<void> {
    const initialized = await this.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'trackt-igdb-seed', version: '1.0.0' },
    });
    if (initialized.error) throw new Error('Could not initialize IGDB MCP server');
    this.child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
    );
  }

  async call<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const message = await this.request('tools/call', { name, arguments: args });
    if (message.error) throw new Error(`IGDB MCP ${name}: ${JSON.stringify(message.error)}`);
    const result = message.result as
      { isError?: boolean; structuredContent?: T; content?: { text?: string }[] } | undefined;
    if (!result || result.isError) throw new Error(`IGDB MCP ${name} returned an error`);
    if (result.structuredContent) return result.structuredContent;
    const text = result.content?.find((part) => part.text)?.text;
    if (text) return JSON.parse(text) as T;
    throw new Error(`IGDB MCP ${name} returned no data`);
  }

  close(): void {
    this.child.kill();
  }
}

async function detailsMap<T extends { id: number }>(
  client: IgdbMcp,
  entity: string,
  ids: number[],
  fields: string[],
): Promise<Map<number, T>> {
  const result = new Map<number, T>();
  const unique = [...new Set(ids)];
  for (let offset = 0; offset < unique.length; offset += DETAIL_BATCH_SIZE) {
    const batch = unique.slice(offset, offset + DETAIL_BATCH_SIZE);
    const response = await client.call<{ results: T[] }>('get_details', {
      entity,
      ids: batch,
      fields,
    });
    for (const row of response.results ?? []) result.set(row.id, row);
    console.log(
      `Resolved ${entity}: ${Math.min(offset + batch.length, unique.length)}/${unique.length}`,
    );
  }
  return result;
}

function uuidV5(name: string): string {
  const ns = Buffer.from(NAMESPACE.replaceAll('-', ''), 'hex');
  const hash = createHash('sha1')
    .update(Buffer.concat([ns, Buffer.from(name)]))
    .digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function slug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

function toSeedRow(
  game: IgdbGame,
  genres: Map<number, { name: string; slug?: string }>,
  platforms: Map<number, { name: string }>,
  covers: Map<number, { image_id: string }>,
  gameTypes: Map<number, { type: string }>,
  parents: Map<number, { name: string }>,
  releaseStatuses: Map<number, string>,
  gameStatuses: Map<number, string>,
) {
  const cover = game.cover === undefined ? undefined : covers.get(game.cover);
  const parentId = game.parent_game ?? game.version_parent;
  const parent = parentId === undefined ? undefined : parents.get(parentId);
  const releaseStatus = (game.release_dates ?? [])
    .map((id) => releaseStatuses.get(id))
    .filter((status): status is string => status !== undefined)
    .sort((a, b) => releaseStatusRank(a) - releaseStatusRank(b))[0];
  return {
    id: uuidV5(`igdb:game:${game.id}`),
    kind: 'game',
    title: game.name,
    synonyms: [],
    year: game.first_release_date
      ? new Date(
          typeof game.first_release_date === 'number'
            ? game.first_release_date * 1000
            : game.first_release_date,
        ).getUTCFullYear()
      : null,
    status: null,
    genres: [
      ...new Set(
        (game.genres ?? []).flatMap((id) => {
          const genre = genres.get(id);
          return genre ? [slug(genre.slug ?? genre.name)] : [];
        }),
      ),
    ],
    partCount: null,
    seasonNumber: null,
    externalIds: { igdb: game.id },
    metadata: {
      format: 'game',
      igdbType:
        game.game_type === undefined || game.game_type === 0
          ? 'Main Game'
          : (gameTypes.get(game.game_type)?.type ?? 'Other'),
      ...(game.version_title ? { editionTitle: game.version_title } : {}),
      ...(parent ? { parentTitle: parent.name } : {}),
      providerScore: game.total_rating ?? null,
      ratingCount: game.total_rating_count ?? 0,
      ...(game.game_status !== undefined && gameStatuses.has(game.game_status)
        ? { igdbStatus: gameStatuses.get(game.game_status) }
        : releaseStatus
          ? { igdbStatus: releaseStatus }
          : {}),
      platforms: (game.platforms ?? []).flatMap((id) => {
        const platform = platforms.get(id);
        return platform ? [platform.name] : [];
      }),
      ...(game.url || game.slug
        ? { igdbUrl: game.url ?? `https://www.igdb.com/games/${game.slug}` }
        : {}),
    },
    description: game.summary ?? null,
    coverUrl: cover?.image_id
      ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${cover.image_id}.jpg`
      : null,
    bannerUrl: null,
  };
}

function releaseStatusRank(status: string): number {
  return (
    {
      'Full Release': 0,
      Released: 0,
      'Early Access': 1,
      Beta: 2,
      Alpha: 3,
    }[status] ?? 4
  );
}

export async function scrapeIgdb(args: Args): Promise<number> {
  const { clientId, clientSecret } = await credentials();
  const client = new IgdbMcp(clientId, clientSecret);
  const games: IgdbGame[] = [];
  try {
    await client.start();
    const seenIds = new Set<number>();
    const scanLimit = args.limit + 5_000;
    // IGDB only holds a few thousand games above any useful vote floor, so a
    // run that stops because the source ran out is not a partial seed.
    let exhausted = false;
    for (let offset = 0; offset < scanLimit && games.length < args.limit; offset += PAGE_SIZE) {
      const pageSize = PAGE_SIZE;
      const page = await client.call<{ results: IgdbGame[] }>('query', {
        entity: 'game',
        filters: { total_rating: { gte: 0 }, total_rating_count: { gte: args.minRatingCount } },
        sort: { field: 'total_rating', order: 'DESC' },
        fields: [
          'name',
          'total_rating',
          'total_rating_count',
          'first_release_date',
          'summary',
          'url',
          'slug',
          'genres',
          'platforms',
          'cover',
          'game_type',
          'game_status',
          'release_dates',
          'parent_game',
          'version_parent',
          'version_title',
        ],
        limit: pageSize,
        offset,
      });
      if (!page.results?.length) {
        exhausted = true;
        break;
      }
      for (const game of page.results) {
        if (NON_WORK_GAME_TYPES.has(game.game_type ?? 0)) continue;
        if (!seenIds.has(game.id)) {
          seenIds.add(game.id);
          games.push(game);
        }
      }
      console.log(
        `Scanned through ${offset + page.results.length}; collected ${games.length}/${args.limit} unique games`,
      );
      if (page.results.length < pageSize) {
        exhausted = true;
        break;
      }
    }
    if (games.length < args.limit && !exhausted) {
      throw new Error(
        `IGDB returned only ${games.length} eligible games; refusing to write a partial ${args.limit}-row seed.`,
      );
    }
    if (games.length < args.limit) {
      console.log(
        `IGDB has ${games.length} eligible games at ${args.minRatingCount}+ ratings; writing all of them.`,
      );
    }
    const genreIds = games.flatMap((game) => game.genres ?? []);
    const selectedGames = games.slice(0, args.limit);
    const platformIds = selectedGames.flatMap((game) => game.platforms ?? []);
    const coverIds = selectedGames.flatMap((game) =>
      game.cover === undefined ? [] : [game.cover],
    );
    const gameTypeIds = selectedGames.flatMap((game) =>
      game.game_type === undefined || game.game_type === 0 ? [] : [game.game_type],
    );
    const parentIds = selectedGames.flatMap((game) =>
      [game.parent_game, game.version_parent].filter((id): id is number => id !== undefined),
    );
    const releaseDateIds = selectedGames.flatMap((game) => game.release_dates ?? []);
    const gameStatusIds = selectedGames.flatMap((game) =>
      game.game_status === undefined ? [] : [game.game_status],
    );
    const [genres, platforms, covers, gameTypes, parents, releaseDateRows, gameStatusRows] =
      await Promise.all([
        detailsMap<{ id: number; name: string; slug?: string }>(client, 'genre', genreIds, [
          'name',
          'slug',
        ]),
        detailsMap<{ id: number; name: string }>(client, 'platform', platformIds, ['name']),
        detailsMap<{ id: number; image_id: string }>(client, 'cover', coverIds, ['image_id']),
        detailsMap<{ id: number; type: string }>(client, 'game_type', gameTypeIds, ['type']),
        detailsMap<{ id: number; name: string }>(client, 'game', parentIds, ['name']),
        detailsMap<{ id: number; status?: number }>(client, 'release_date', releaseDateIds, [
          'status',
        ]),
        detailsMap<{ id: number; status: string }>(client, 'game_status', gameStatusIds, [
          'status',
        ]),
      ]);
    const releaseStatusIds = [...releaseDateRows.values()].flatMap((row) =>
      row.status === undefined ? [] : [row.status],
    );
    const releaseStatusRows = await detailsMap<{ id: number; name: string }>(
      client,
      'release_date_status',
      releaseStatusIds,
      ['name'],
    );
    const releaseStatuses = new Map<number, string>();
    for (const [releaseDateId, row] of releaseDateRows) {
      const name = row.status === undefined ? undefined : releaseStatusRows.get(row.status)?.name;
      if (name) releaseStatuses.set(releaseDateId, name);
    }

    const output = resolve(args.out);
    await mkdir(dirname(output), { recursive: true });
    const temporary = `${output}.tmp`;
    const data = {
      generatedAt: new Date().toISOString(),
      source: 'IGDB',
      ranking: {
        order: 'total_rating desc',
        minimumRatingCount: args.minRatingCount,
        limit: args.limit,
      },
      catalog_media: selectedGames.map((game) =>
        toSeedRow(
          game,
          genres,
          platforms,
          covers,
          gameTypes,
          parents,
          releaseStatuses,
          new Map([...gameStatusRows].map(([id, row]) => [id, row.status])),
        ),
      ),
      catalog_media_relation: [],
    };
    await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await chmod(temporary, 0o600);
    await rename(temporary, output);
    console.log(`Wrote ${selectedGames.length} games to ${output}`);
    return selectedGames.length;
  } finally {
    client.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  scrapeIgdb(parseArgs(process.argv.slice(2))).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
