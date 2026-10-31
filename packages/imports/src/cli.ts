import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { eq, or } from 'drizzle-orm';
import { createDb, users } from '@trackt/db';
import { EnvValidationError, loadEnv } from '@trackt/shared';
import { buildPlanReport, planReportCsv, type PlanReport } from './report.js';
import { replayImportReport } from './replay.js';
import { runImport } from './run.js';
import { IMPORT_SOURCES } from './sources.js';
import type { ImportCredentials, ImportSource } from './types.js';

/**
 * `pnpm import -- --source <mal|anilist|letterboxd|trakt> --user <email|uuid> --profile <name> [--dry-run] [--overwrite] [--enrich] [--report <file>] [--from-report <file>]`
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
  /** Where the whole plan goes: JSON, or CSV when the path says so. */
  report: string | null;
  /** Re-resolve a saved report instead of fetching: no network, no provider. */
  fromReport: string | null;
  /** Skip the central-catalog lookup (`CATALOG_URL`), for a strictly local run. */
  noCatalog: boolean;
}

const DEFAULT_SOURCE: ImportSource = 'mal';

const USAGE =
  'usage: pnpm import -- --source <mal|anilist|letterboxd|trakt> --user <email|uuid> --profile <name> ' +
  '[--dry-run] [--overwrite] [--enrich] [--report <file>] [--from-report <file>] [--no-catalog]';

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
    report: null,
    fromReport: null,
    noCatalog: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    // `pnpm import -- --user …` forwards the separator as an argument.
    if (arg === '--') continue;
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--overwrite') args.overwrite = true;
    else if (arg === '--enrich') args.enrich = true;
    else if (arg === '--report') args.report = argv[++i] ?? '';
    else if (arg === '--no-catalog') args.noCatalog = true;
    else if (arg === '--from-report') args.fromReport = argv[++i] ?? '';
    else if (arg?.startsWith('--from-report='))
      args.fromReport = arg.slice('--from-report='.length);
    else if (arg?.startsWith('--report=')) args.report = arg.slice('--report='.length);
    else if (arg === '--source') args.source = parseSource(argv[++i]);
    else if (arg === '--user') args.user = argv[++i] ?? '';
    else if (arg === '--profile') args.profile = argv[++i] ?? '';
    else if (arg?.startsWith('--source=')) args.source = parseSource(arg.slice('--source='.length));
    else if (arg?.startsWith('--user=')) args.user = arg.slice('--user='.length);
    else if (arg?.startsWith('--profile=')) args.profile = arg.slice('--profile='.length);
    else throw new Error(`unknown argument "${arg}"\n${USAGE}`);
  }
  // A replay carries the profile in the report it reads.
  if (!args.user || (!args.profile && !args.fromReport)) throw new Error(USAGE);
  if (args.report === '') throw new Error(`--report needs a path\n${USAGE}`);
  if (args.fromReport === '') throw new Error(`--from-report needs a path\n${USAGE}`);
  if (args.fromReport && args.enrich)
    throw new Error(`--from-report has nothing to fetch\n${USAGE}`);
  return args;
}

/** `MAL_CLIENT_ID` → `malClientId`: the `ImportCredentials` field an env var fills. */
function credentialField(envName: string): keyof ImportCredentials {
  const [first, ...rest] = envName.toLowerCase().split('_');
  const camel = [first, ...rest.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)];
  return camel.join('') as keyof ImportCredentials;
}

/** A saved plan, read back for `--from-report`; a wrong file fails by name, not by stack. */
async function readReport(file: string): Promise<PlanReport> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(
      `cannot read the report at ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const report = parsed as PlanReport;
  if (!report || !Array.isArray(report.rows) || !(report.source in IMPORT_SOURCES)) {
    throw new Error(`${file} is not an import report (run one with --report <file>)`);
  }
  return report;
}

function line(label: string, value: number | string): string {
  return `  ${label.padEnd(14)} ${value}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const definition = IMPORT_SOURCES[args.source];

  const env = loadEnv();
  const credentials: ImportCredentials = {};
  if (definition.credential && !args.fromReport) {
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

    const saved = args.fromReport ? await readReport(resolve(args.fromReport)) : null;
    const source = saved?.source ?? args.source;
    const profile = saved?.profile ?? args.profile;

    console.log(
      `importing ${IMPORT_SOURCES[source].label} "${profile}" into ${user.username ?? user.email}` +
        ` (${args.dryRun ? 'dry run — nothing will be written' : 'applying'})` +
        (saved ? ', re-matching the saved report — no provider request' : ''),
    );

    const catalogUrl = args.noCatalog ? undefined : env.CATALOG_URL;

    const { plan, report } = saved
      ? await replayImportReport(db, {
          userId: user.id,
          report: saved,
          dryRun: args.dryRun,
          overwrite: args.overwrite,
          ...(catalogUrl ? { catalogUrl } : {}),
        })
      : await runImport(db, {
          ...(catalogUrl ? { catalogUrl } : {}),
          userId: user.id,
          source,
          profile,
          credentials,
          dryRun: args.dryRun,
          overwrite: args.overwrite,
          enrichFilmPages: args.enrich,
        });

    // A replay that actually writes refreshes the file it read, so the next
    // replay starts from the current state rather than a stale one.
    if (args.report || (saved && !args.dryRun)) {
      // Written before the console report is truncated: a run's unmatched rows
      // exist nowhere else once the process exits.
      const file = resolve(args.report ?? args.fromReport!);
      const report = buildPlanReport(plan, { applied: !args.dryRun });
      await mkdir(dirname(file), { recursive: true });
      await writeFile(
        file,
        file.endsWith('.csv') ? planReportCsv(report) : `${JSON.stringify(report, null, 2)}\n`,
        'utf8',
      );
      console.log(`\nreport written to ${file}`);
    }

    console.log(`\nplan (${source}:${profile})`);
    console.log(line('rows', plan.summary.total));
    console.log(line('in catalog', plan.summary.matched));
    console.log(line('not in catalog', plan.summary.unmatched));
    console.log(line('already logged', plan.summary.existing));
    console.log(line('pending', plan.summary.pending));
    console.log(line('warnings', plan.summary.warnings));
    const uncertain = plan.rows.filter((row) => row.uncertain !== null).length;
    if (uncertain > 0) console.log(line('uncertain', uncertain));

    const byTitle = plan.rows.filter((row) => row.matchedBy === 'title').length;
    if (byTitle > 0) console.log(line('by title', byTitle));
    if (plan.summary.fromCatalog > 0) {
      console.log(line('from catalog', plan.summary.fromCatalog));
    }
    if (plan.summary.favourites > 0) {
      console.log(line('favourites', plan.summary.favourites));
    }

    if (report) {
      console.log('\nwritten');
      console.log(line('created', report.created));
      console.log(line('updated', report.updated));
      console.log(line('skipped (log)', report.skippedExisting));
      console.log(line('with progress', report.withProgress));
      console.log(line('with score', report.ratings));
      if (report.uncertain > 0) console.log(line('uncertain', report.uncertain));
      if (report.favourites > 0) console.log(line('favourites', report.favourites));
    }

    if (plan.warnings.length > 0) {
      console.log('\nwarnings');
      for (const w of plan.warnings.slice(0, 20)) {
        console.log(
          `  [${w.code}] ${w.title ?? '—'} (${source} ${w.externalId ?? '—'}): ${w.message}`,
        );
      }
      if (plan.warnings.length > 20) console.log(`  … ${plan.warnings.length - 20} more`);
    }

    const unmatched = plan.rows.filter((row) => row.target === null);
    if (unmatched.length > 0) {
      console.log('\nnot in this instance’s catalog (skipped)');
      for (const row of unmatched.slice(0, 30)) {
        console.log(`  ${source} ${row.entry.externalId}  ${row.entry.title}`);
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
