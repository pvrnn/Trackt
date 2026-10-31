import { eq, or } from 'drizzle-orm';
import { createDb, users } from '@trackt/db';
import { EnvValidationError, loadEnv } from '@trackt/shared';
import { runMalImport } from './run.js';

/**
 * `pnpm import:mal -- --user <email|uuid> --profile <mal username> [--dry-run] [--overwrite]`
 *
 * The first driver of the importer, and deliberately the only one for now: the
 * product surface (a wizard that enqueues an `importer` job) is a later step, so
 * the pipeline is exercised without building a UI around it first.
 */

interface Args {
  user: string;
  profile: string;
  dryRun: boolean;
  overwrite: boolean;
}

const USAGE =
  'usage: pnpm import:mal -- --user <email|uuid> --profile <myanimelist username> [--dry-run] [--overwrite]';

function parseArgs(argv: string[]): Args {
  const args: Args = { user: '', profile: '', dryRun: false, overwrite: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    // `pnpm import:mal -- --user …` forwards the separator as an argument.
    if (arg === '--') continue;
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--overwrite') args.overwrite = true;
    else if (arg === '--user') args.user = argv[++i] ?? '';
    else if (arg === '--profile') args.profile = argv[++i] ?? '';
    else if (arg?.startsWith('--user=')) args.user = arg.slice('--user='.length);
    else if (arg?.startsWith('--profile=')) args.profile = arg.slice('--profile='.length);
    else throw new Error(`unknown argument "${arg}"\n${USAGE}`);
  }
  if (!args.user || !args.profile) throw new Error(USAGE);
  return args;
}

function line(label: string, value: number | string): string {
  return `  ${label.padEnd(14)} ${value}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const env = loadEnv();
  if (!env.MAL_CLIENT_ID) {
    throw new Error(
      'MAL_CLIENT_ID is not set — create an API client at https://myanimelist.net/apiconfig ' +
        'and export its Client ID (public lists need nothing else).',
    );
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
      `importing MyAnimeList "${args.profile}" into ${user.username ?? user.email}` +
        ` (${args.dryRun ? 'dry run — nothing will be written' : 'applying'})`,
    );

    const { plan, report } = await runMalImport(db, {
      userId: user.id,
      profile: args.profile,
      clientId: env.MAL_CLIENT_ID,
      dryRun: args.dryRun,
      overwrite: args.overwrite,
    });

    console.log(`\nplan (mal:${args.profile})`);
    console.log(line('rows', plan.summary.total));
    console.log(line('in catalog', plan.summary.matched));
    console.log(line('not in catalog', plan.summary.unmatched));
    console.log(line('already logged', plan.summary.existing));
    console.log(line('pending', plan.summary.pending));
    console.log(line('warnings', plan.summary.warnings));

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
        console.log(`  [${w.code}] ${w.title ?? '—'} (mal ${w.externalId ?? '—'}): ${w.message}`);
      }
      if (plan.warnings.length > 20) console.log(`  … ${plan.warnings.length - 20} more`);
    }

    const unmatched = plan.rows.filter((row) => row.target === null);
    if (unmatched.length > 0) {
      console.log('\nnot in this instance’s catalog (skipped)');
      for (const row of unmatched.slice(0, 30)) {
        console.log(`  mal ${row.entry.externalId}  ${row.entry.title}`);
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
