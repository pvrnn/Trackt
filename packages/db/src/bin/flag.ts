import { eq } from 'drizzle-orm';
import { FLAG_DEFINITIONS, FLAG_KEYS, parseFlagOverrides, type FlagKey } from '@trackt/shared';
import { createDb } from '../index.js';
import { featureFlags } from '../schema/index.js';

/**
 * Feature-flag CLI for operators without a session (ADR-0011). Same table, same
 * registry and same first-write seeding as `PATCH /v1/admin/flags` — there is no
 * second implementation of the rules.
 *
 *   pnpm --filter @trackt/db db:flag -- lists.custom=off
 *   pnpm --filter @trackt/db db:flag -- lists.custom=25 --countries=FR,BE
 *   pnpm --filter @trackt/db db:flag:list
 */

const args = process.argv.slice(2);
const flagArgs = args.filter((arg) => !arg.startsWith('--'));
const option = (name: string): string | undefined => {
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
};

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://trackt:trackt@localhost:5432/trackt';
const db = createDb(databaseUrl, { max: 1 });

function usage(): never {
  console.error(
    [
      'Usage:',
      '  db:flag -- <key>=on|off|0-100 [--countries=FR,BE] [--from=ISO] [--until=ISO]',
      '  db:flag -- <key> --reset     (drop the row, back to the compiled default)',
      '  db:flag:list',
    ].join('\n'),
  );
  process.exit(1);
}

function formatRow(row: typeof featureFlags.$inferSelect): string {
  const countries = row.countries.length > 0 ? ` countries=${row.countries.join(',')}` : '';
  const window = [
    row.startsAt ? `from=${row.startsAt.toISOString()}` : '',
    row.endsAt ? `until=${row.endsAt.toISOString()}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `${row.key}: enabled=${row.enabled} rollout=${row.rollout}%${countries}${window ? ` ${window}` : ''}`;
}

async function list(): Promise<void> {
  const rows = await db.select().from(featureFlags);
  const byKey = new Map(rows.map((row) => [row.key, row]));
  for (const key of FLAG_KEYS) {
    const definition = FLAG_DEFINITIONS[key];
    const row = byKey.get(key);
    console.log(
      row
        ? `  ${formatRow(row)}`
        : `  ${key}: no rule — compiled default ${definition.default ? 'on' : 'off'} (remove by ${definition.removeBy})`,
    );
  }
  const orphans = rows.filter((row) => !(row.key in FLAG_DEFINITIONS));
  for (const row of orphans) console.log(`  ${formatRow(row)}  (no longer in the registry)`);
  process.exit(0);
}

async function set(): Promise<void> {
  const assignment = flagArgs[0];
  if (!assignment) usage();

  const separator = assignment.indexOf('=');
  const key = separator === -1 ? assignment : assignment.slice(0, separator);
  const value = separator === -1 ? '' : assignment.slice(separator + 1);

  if (!(key in FLAG_DEFINITIONS)) {
    console.error(`Unknown flag '${key}' — the registry has: ${FLAG_KEYS.join(', ')}`);
    process.exit(1);
  }
  const typed = key as FlagKey;
  const definition = FLAG_DEFINITIONS[typed];

  if (args.includes('--reset')) {
    await db.delete(featureFlags).where(eq(featureFlags.key, typed));
    console.log(`${typed}: rule removed — back to the compiled default (${definition.default})`);
    process.exit(0);
  }

  if (parseFlagOverrides(process.env.FEATURE_FLAGS).overrides[typed] !== undefined) {
    console.warn(
      `Warning: FEATURE_FLAGS already owns ${typed} — this row will not be consulted until it is removed.`,
    );
  }

  const [existing] = await db
    .select()
    .from(featureFlags)
    .where(eq(featureFlags.key, typed))
    .limit(1);

  const seed = { enabled: true, rollout: definition.default ? 100 : 0 };
  const next = {
    enabled: existing?.enabled ?? seed.enabled,
    rollout: existing?.rollout ?? seed.rollout,
    countries: existing?.countries ?? [],
    startsAt: existing?.startsAt ?? null,
    endsAt: existing?.endsAt ?? null,
    updatedAt: new Date(),
    updatedBy: null,
  };

  if (value === 'on') {
    next.enabled = true;
  } else if (value === 'off') {
    next.enabled = false;
  } else if (/^\d{1,3}$/.test(value) && Number(value) <= 100) {
    next.enabled = true;
    next.rollout = Number(value);
  } else {
    console.error(`Value '${value}' is not on, off or 0-100.`);
    process.exit(1);
  }

  const countries = option('countries');
  if (countries !== undefined) {
    const list = countries
      .split(',')
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean);
    const invalid = list.filter((code) => !/^[A-Z]{2}$/.test(code));
    if (invalid.length > 0) {
      console.error(`Not ISO 3166-1 alpha-2: ${invalid.join(', ')}`);
      process.exit(1);
    }
    next.countries = list;
  }

  for (const [optionName, field] of [
    ['from', 'startsAt'],
    ['until', 'endsAt'],
  ] as const) {
    const raw = option(optionName);
    if (raw === undefined) continue;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      console.error(`--${optionName}=${raw} is not a date.`);
      process.exit(1);
    }
    next[field] = date;
  }

  await db
    .insert(featureFlags)
    .values({ key: typed, ...next })
    .onConflictDoUpdate({ target: featureFlags.key, set: next });

  console.log(formatRow({ key: typed, ...next, updatedBy: next.updatedBy }));
  process.exit(0);
}

try {
  if (flagArgs[0] === 'list' || args.includes('--list')) await list();
  else await set();
} catch (error) {
  console.error('Feature flag update failed:', error);
  process.exit(1);
}
