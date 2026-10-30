import { eq, or } from 'drizzle-orm';
import { createDb, users } from '@trackt/db';
import { EnvValidationError, loadEnv } from '@trackt/shared';
import { runImport } from './run.js';
import { IMPORT_SOURCES } from './sources.js';
import type { ImportCredentials, ImportSource } from './types.js';

/**
 * `pnpm import -- --source <mal|anilist|letterboxd> --user <email|uuid> --profile <name> [--dry-run] [--overwrite] [--enrich]`
 *
 * The first driver of the importer: the product surface (a wizard that enqueues
 * an `importer` job) is a later step, so the pipeline is exercised without
 * building a UI around it first.
 */

interface Args {
  source: ImportSource;
  user: string;
  profile: string;
  dryRun: boolean;
  overwrite: boolean;
  enrich: boolean;
}

const DEFAULT_SOURCE: ImportSource = 'mal';

const USAGE =
  'usage: pnpm import -- --source <mal|anilist|letterboxd> --user <email|uuid> --profile <name> ' +
  '[--dry-run] [--overwrite] [--enrich]';

function parseSource(value: string | undefined): ImportSource {
  const source = (value ?? DEFAULT_SOURCE) as ImportSource;
  if (!(source in IMPORT_SOURCES)) throw new Error(`unknown source "${source}"\n${USAGE}`);
  return source;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    source: DEFAULT_SOURCE,
    user: '',
    profile: '',
    dryRun: false,
    overwrite: false,
    enrich: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    // `pnpm import -- --user …` forwards the separator as an argument.
    if (arg === '--') continue;
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--overwrite') args.overwrite = true;
    else if (arg === '--enrich') args.enrich = true;
    else if (arg === '--source') args.source = parseSource(argv[++i]);
    else if (arg === '--user') args.user = argv[++i] ?? '';
    else if (arg === '--profile') args.profile = argv[++i] ?? '';
    else if (arg?.startsWith('--source=')) args.source = parseSource(arg.slice('--source='.length));
    else if (arg?.startsWith('--user=')) args.user = arg.slice('--user='.length);
    else if (arg?.startsWith('--profile=')) args.profile = arg.slice('--profile='.length);
    else throw new Error(`unknown argument "${arg}"\n${USAGE}`);
  }
  if (!args.user || !args.profile) throw new Error(USAGE);
  return args;
}

/** `MAL_CLIENT_ID` → `malClientId`: the `ImportCredentials` field an env var fills. */
function credentialField(envName: string): keyof ImportCredentials {
  const [first, ...rest] = envName.toLowerCase().split('_');
  const camel = [first, ...rest.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)];
  return camel.join('') as keyof ImportCredentials;
}

function line(label: string, value: number | string): string {
  return `  ${label.padEnd(14)} ${value}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const definition = IMPORT_SOURCES[args.source];

  const env = loadEnv();
  const credentials: ImportCredentials = {};
  if (definition.credential) {
    const field = credentialField(definition.credential.env);
    const value = env[definition.credential.env as keyof typeof env];
    if (typeof value !== 'string' || !value) {
      throw new Error(`${definition.credential.env} is not set — ${definition.credential.hint}`);
    }
    credentials[field] = value;
  }

  const db = createDb(env.DATABASE_URL, { max: 2 });
  try {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      args.user,
    );
    const [user] = await db
      .select({ id: users.id, email: users.email, username: users.username })
      .from(users)
      .where(
        isUuid
          ? or(eq(users.id, args.user), eq(users.email, args.user))
          : eq(users.email, args.user),
      )
      .limit(1);
    if (!user) throw new Error(`no local user matches "${args.user}"`);

    console.log(
      `importing ${definition.label} "${args.profile}" into ${user.username ?? user.email}` +
        ` (${args.dryRun ? 'dry run — nothing will be written' : 'applying'})`,
    );

    const { plan, report } = await runImport(db, {
      userId: user.id,
      source: args.source,
      profile: args.profile,
      credentials,
      dryRun: args.dryRun,
      overwrite: args.overwrite,
      enrichFilmPages: args.enrich,
    });

    console.log(`\nplan (${args.source}:${args.profile})`);
    console.log(line('rows', plan.summary.total));
    console.log(line('in catalog', plan.summary.matched));
    console.log(line('not in catalog', plan.summary.unmatched));
    console.log(line('already logged', plan.summary.existing));
    console.log(line('pending', plan.summary.pending));
    console.log(line('warnings', plan.summary.warnings));

    const byTitle = plan.rows.filter((row) => row.matchedBy === 'title').length;
    if (byTitle > 0) console.log(line('by title', byTitle));

    if (report) {
      console.log('\nwritten');
      console.log(line('created', report.created));
      console.log(line('updated', report.updated));
      console.log(line('skipped (log)', report.skippedExisting));
      console.log(line('with progress', report.withProgress));
      console.log(line('with score', report.ratings));
    }

    if (plan.warnings.length > 0) {
      console.log('\nwarnings');
      for (const w of plan.warnings.slice(0, 20)) {
        console.log(
          `  [${w.code}] ${w.title ?? '—'} (${args.source} ${w.externalId ?? '—'}): ${w.message}`,
        );
      }
      if (plan.warnings.length > 20) console.log(`  … ${plan.warnings.length - 20} more`);
    }

    const unmatched = plan.rows.filter((row) => row.target === null);
    if (unmatched.length > 0) {
      console.log('\nnot in this instance’s catalog (skipped)');
      for (const row of unmatched.slice(0, 30)) {
        console.log(`  ${args.source} ${row.entry.externalId}  ${row.entry.title}`);
      }
      if (unmatched.length > 30) console.log(`  … ${unmatched.length - 30} more`);
    }
  } finally {
    // postgres-js holds the pool open; the CLI must exit once the report is out.
    await db.$client.end();
  }
}

main().catch((error: unknown) => {
  if (error instanceof EnvValidationError) {
    console.error(error.message);
    process.exit(1);
  }
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
