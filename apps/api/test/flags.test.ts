import { describe, expect, it } from 'vitest';
import { loadEnv, type FlagDefinition } from '@trackt/shared';
import { bucket, countryFrom, evaluate, type FlagRuleRow } from '../src/lib/flags.js';

const definition: FlagDefinition = {
  summary: 'test flag',
  owner: 'test',
  default: false,
  removeBy: '2027-01-01',
};

/** Deterministic uuid-shaped ids, so a failure is reproducible. */
function ids(count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `00000000-0000-5000-8000-${String(index).padStart(12, '0')}`,
  );
}

function rule(overrides: Partial<FlagRuleRow> = {}): FlagRuleRow {
  return {
    key: 'lists.custom',
    enabled: true,
    rollout: 100,
    countries: [],
    startsAt: null,
    endsAt: null,
    ...overrides,
  };
}

describe('bucket', () => {
  it('is stable for one flag and user', () => {
    expect(bucket('lists.custom', 'user-1')).toBe(bucket('lists.custom', 'user-1'));
  });

  it('is independent per flag', () => {
    const population = ids(200);
    const a = population.map((id) => bucket('lists.custom', id));
    const b = population.map((id) => bucket('other.feature', id));
    // The same unlucky 10% must not be excluded from every feature forever.
    expect(a).not.toEqual(b);
  });

  it('spreads ids evenly at 1, 10 and 50 percent', () => {
    const population = ids(10_000);
    for (const percent of [1, 10, 50]) {
      const hits = population.filter((id) => bucket('lists.custom', id) < percent * 100).length;
      const expected = (percent / 100) * population.length;
      // Four standard deviations: a broken hash (constant, zero, or lumped)
      // misses this by orders of magnitude, while honest sampling noise passes.
      const deviation = 4 * Math.sqrt(population.length * (percent / 100) * (1 - percent / 100));
      expect(Math.abs(hits - expected)).toBeLessThanOrEqual(deviation);
    }
  });

  it('is monotonic: widening a rollout never evicts anyone', () => {
    for (const id of ids(2_000)) {
      const b = bucket('lists.custom', id);
      if (b < 1 * 100) expect(b).toBeLessThan(10 * 100);
      if (b < 10 * 100) expect(b).toBeLessThan(50 * 100);
      if (b < 50 * 100) expect(b).toBeLessThan(100 * 100);
    }
  });
});

describe('evaluate — precedence', () => {
  const now = new Date('2026-10-29T12:00:00Z');

  it('answers the compiled default when there is no row', () => {
    expect(evaluate({ key: 'lists.custom', definition, rule: null, context: {}, now })).toBe(false);
    expect(
      evaluate({
        key: 'lists.custom',
        definition: { ...definition, default: true },
        rule: null,
        context: {},
        now,
      }),
    ).toBe(true);
  });

  it('lets an env override win over the row, in both directions', () => {
    expect(
      evaluate({
        key: 'lists.custom',
        definition,
        rule: rule({ enabled: false }),
        context: { userId: 'user-1' },
        envOverride: true,
        now,
      }),
    ).toBe(true);
    expect(
      evaluate({
        key: 'lists.custom',
        definition,
        rule: rule(),
        context: { userId: 'user-1' },
        envOverride: false,
        now,
      }),
    ).toBe(false);
  });

  it('reads an env percent as a rollout, with no hashing at 100', () => {
    expect(evaluate({ key: 'lists.custom', definition, context: {}, envOverride: 100, now })).toBe(
      true,
    );
    expect(evaluate({ key: 'lists.custom', definition, context: {}, envOverride: 50, now })).toBe(
      false,
    );
  });

  it('lets the kill switch beat a per-user grant', () => {
    expect(
      evaluate({
        key: 'lists.custom',
        definition,
        rule: rule({ enabled: false }),
        override: true,
        context: { userId: 'user-1' },
        now,
      }),
    ).toBe(false);
  });

  it('lets a grant beat a country the allowlist excludes', () => {
    expect(
      evaluate({
        key: 'lists.custom',
        definition,
        rule: rule({ countries: ['FR'], rollout: 0 }),
        override: true,
        context: { userId: 'user-1', country: 'DE' },
        now,
      }),
    ).toBe(true);
  });

  it('lets a deny beat the rollout', () => {
    expect(
      evaluate({
        key: 'lists.custom',
        definition,
        rule: rule(),
        override: false,
        context: { userId: 'user-1' },
        now,
      }),
    ).toBe(false);
  });

  it('requires a viewer below 100%', () => {
    expect(
      evaluate({
        key: 'lists.custom',
        definition,
        rule: rule({ rollout: 100 }),
        context: {},
        now,
      }),
    ).toBe(true);
    expect(
      evaluate({
        key: 'lists.custom',
        definition,
        rule: rule({ rollout: 99 }),
        context: {},
        now,
      }),
    ).toBe(false);
    expect(
      evaluate({
        key: 'lists.custom',
        definition,
        rule: rule({ rollout: 0 }),
        context: { userId: 'user-1' },
        now,
      }),
    ).toBe(false);
  });

  it('buckets a signed-in viewer below 100%', () => {
    const population = ids(400);
    const hits = population.filter((id) =>
      evaluate({
        key: 'lists.custom',
        definition,
        rule: rule({ rollout: 10 }),
        context: { userId: id },
        now,
      }),
    );
    expect(hits.length).toBeGreaterThan(20);
    expect(hits.length).toBeLessThan(60);
  });
});

describe('evaluate — schedule', () => {
  const window = {
    startsAt: new Date('2026-11-01T00:00:00Z'),
    endsAt: new Date('2026-12-01T00:00:00Z'),
  };

  function at(iso: string): boolean {
    return evaluate({
      key: 'lists.custom',
      definition,
      rule: rule(window),
      context: { userId: 'user-1' },
      now: new Date(iso),
    });
  }

  it('is off before the window', () => {
    expect(at('2026-10-31T23:59:59Z')).toBe(false);
  });

  it('is on at the inclusive start', () => {
    expect(at('2026-11-01T00:00:00Z')).toBe(true);
  });

  it('is off at the exclusive end', () => {
    expect(at('2026-12-01T00:00:00Z')).toBe(false);
  });

  it('treats a null bound as open', () => {
    expect(
      evaluate({
        key: 'lists.custom',
        definition,
        rule: rule({ startsAt: null, endsAt: window.endsAt }),
        context: { userId: 'user-1' },
        now: new Date('2020-01-01T00:00:00Z'),
      }),
    ).toBe(true);
  });
});

describe('evaluate — country', () => {
  it('admits a listed country and excludes another', () => {
    const base = {
      key: 'lists.custom' as const,
      definition,
      rule: rule({ countries: ['FR', 'BE'] }),
      now: new Date('2026-10-29T12:00:00Z'),
    };
    expect(evaluate({ ...base, context: { userId: 'u', country: 'FR' } })).toBe(true);
    expect(evaluate({ ...base, context: { userId: 'u', country: 'DE' } })).toBe(false);
  });

  it('fails closed when the country is unknown', () => {
    expect(
      evaluate({
        key: 'lists.custom',
        definition,
        rule: rule({ countries: ['FR'] }),
        context: { userId: 'u' },
        now: new Date('2026-10-29T12:00:00Z'),
      }),
    ).toBe(false);
  });

  it('treats an empty allowlist as every country', () => {
    expect(
      evaluate({
        key: 'lists.custom',
        definition,
        rule: rule({ countries: [] }),
        context: {},
        now: new Date('2026-10-29T12:00:00Z'),
      }),
    ).toBe(true);
  });
});

describe('countryFrom', () => {
  const headerEnv = loadEnv({
    NODE_ENV: 'test',
    FLAG_COUNTRY_HEADER: 'cf-ipcountry',
  });

  it('normalises the trusted header', () => {
    expect(countryFrom({ headers: { 'cf-ipcountry': 'fr' } }, headerEnv)).toBe('FR');
  });

  it('treats Cloudflare unknown and Tor as no country', () => {
    expect(countryFrom({ headers: { 'cf-ipcountry': 'XX' } }, headerEnv)).toBeUndefined();
    expect(countryFrom({ headers: { 'cf-ipcountry': 'T1' } }, headerEnv)).toBeUndefined();
  });

  it('falls back to the fixed country', () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      FLAG_COUNTRY_HEADER: 'cf-ipcountry',
      FLAG_COUNTRY: 'fr',
    });
    expect(countryFrom({ headers: {} }, env)).toBe('FR');
  });

  it('prefers the header over the fixed country', () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      FLAG_COUNTRY_HEADER: 'cf-ipcountry',
      FLAG_COUNTRY: 'FR',
    });
    expect(countryFrom({ headers: { 'cf-ipcountry': 'BE' } }, env)).toBe('BE');
  });

  it('is unknown when nothing is configured', () => {
    const env = loadEnv({ NODE_ENV: 'test' });
    expect(countryFrom({ headers: { 'cf-ipcountry': 'FR' } }, env)).toBeUndefined();
  });
});
