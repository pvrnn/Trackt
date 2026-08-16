import { createFileRoute, Link } from '@tanstack/react-router';
import { m } from 'motion/react';
import { useState, type CSSProperties, type ReactNode } from 'react';
import type { MediaKind } from '@trackt/shared';
import { AuraBackground } from '../components/layout/AuraBackground';
import { MarketingFooter } from '../components/layout/MarketingFooter';
import { MarketingNav } from '../components/layout/MarketingNav';
import { UpNextCard } from '../components/media/UpNextCard';
import { buttonClassName } from '../components/ui/Button';
import { GlassCard } from '../components/ui/GlassCard';
import { Tooltip } from '../components/ui/Tooltip';
import { coverGradient, useShowcase } from '@trackt/client';

const MotionLink = m.create(Link);

export const Route = createFileRoute('/')({
  component: Landing,
});

/** One tile in the band — the shape both the real catalog and the fallback produce. */
interface StripItem {
  key: string;
  title: string;
  kind: MediaKind;
  coverUrl: string | null;
}

/**
 * The 12 strip titles from the design handoff. No longer what the band shows
 * when the instance has a catalog — they're the fallback for the case that
 * outnumbers every other on day one: a fresh self-host with an empty `media`
 * table, where the alternative is a marketing page with a blank gap in it.
 */
const FALLBACK_STRIP: { title: string; kind: MediaKind }[] = [
  { title: 'Neon Harbor', kind: 'series' },
  { title: 'Ashfall Chronicle', kind: 'anime' },
  { title: 'Moonlit Courier', kind: 'webtoon' },
  { title: 'The Long Static', kind: 'movie' },
  { title: 'Paper Cities', kind: 'manga' },
  { title: 'Sable Coast', kind: 'series' },
  { title: 'Copper Veil', kind: 'webtoon' },
  { title: 'Glass Orchard', kind: 'anime' },
  { title: 'Hollow Signal', kind: 'movie' },
  { title: 'Ninth Tide', kind: 'manga' },
  { title: 'Static Bloom', kind: 'anime' },
  { title: 'The Ferry Years', kind: 'series' },
];

/** Seconds each tile spends crossing the viewport — the band's speed, not its period. */
const SECONDS_PER_TILE = 4;

/** Below this the loop is too short to read as continuous, so pad it by repeating. */
const MIN_TILES = 10;

const PILLARS = [
  {
    num: '01',
    title: 'Your data, forever',
    body: 'Full export at any time in an open format. Public API from day one. Portability is the founding principle, not a checkbox.',
  },
  {
    num: '02',
    title: 'Self-host in one command',
    body: 'docker compose up and you have your own instance — your catalog, your community, your rules.',
  },
  {
    num: '03',
    title: 'Track at real granularity',
    body: 'Episodes, chapters, volumes, rewatches. Half-point ratings on whole works or single episodes.',
  },
  {
    num: '04',
    title: 'Community catalog',
    body: 'Webtoons and obscure titles the big databases skip? Add them yourself and share them across instances.',
  },
];

function Landing() {
  return (
    <>
      <AuraBackground variant="marketing" />
      <div className="relative">
        <MarketingNav />
        <Hero />
        <Pillars />
        <CheckInBand />
        <MarketingFooter />
      </div>
    </>
  );
}

function Hero() {
  return (
    <section className="overflow-hidden border-b border-divider">
      <div className="mx-auto flex max-w-[1360px] flex-col gap-7 px-6 pt-16 pb-20 sm:px-10 sm:pt-24">
        <p className="text-prism font-label text-[13px] font-semibold tracking-eyebrow">
          OPEN SOURCE · SELF-HOSTABLE · COMMUNITY-OWNED
        </p>
        <h1 className="max-w-[1000px] font-heading text-hero uppercase">
          Track everything.
          <br />
          Lose <span className="text-prism">nothing.</span>
        </h1>
        <p className="max-w-[560px] text-[17px] leading-relaxed text-muted sm:text-[19px]">
          Movies, series, anime, manga, and webtoons — with full export at any time and a public API
          from day one. TV Time deleted 25 million histories. Never again.
        </p>
        <div className="flex flex-wrap gap-3.5">
          <MotionLink
            to="/register"
            whileTap={{ scale: 0.97 }}
            className={buttonClassName({ variant: 'primary', size: 'lg' })}
          >
            START TRACKING
          </MotionLink>
          {/* The TV Time importer (PRD §3.6) hasn't shipped — visibly inert, not a
              disguised register link. */}
          <Tooltip label="The TV Time importer is coming soon">
            <span
              tabIndex={0}
              className="inline-flex cursor-not-allowed items-center justify-center gap-2 rounded-full border border-glass-border bg-glass px-8 py-4 font-sans text-sm font-bold tracking-btn text-muted"
            >
              IMPORT FROM TV TIME · SOON
            </span>
          </Tooltip>
        </div>
        <p className="font-label text-[13px] text-dim">
          or self-host:{' '}
          <code className="rounded-lg border border-glass-border bg-glass-well px-3 py-1.5 text-pink">
            docker compose up
          </code>
        </p>
      </div>
      <CoverStrip />
    </section>
  );
}

/**
 * The band under the hero: what this instance actually carries, rolling left
 * forever.
 *
 * Deliberately **not** links. Every media page is behind `useAuthedPage()`, so
 * a click from here would land a signed-out visitor on /login — a decorative
 * band that turns into an auth wall is worse than one that stays decoration.
 * The whole thing is `aria-hidden` for the same reason: it's the page's mood,
 * and the copy above it already says what Trackt tracks.
 */
function CoverStrip() {
  const { data, isPending } = useShowcase();
  const showcase = data ?? [];

  // Nothing until the catalog answers. The band is client-fetched (the SSR
  // process sits *behind* the API in the monolith and has no route back to
  // it), so rendering the fallback first meant every visitor watched twelve
  // invented titles get replaced by the real catalog a moment later — a flash
  // of fiction presented as this instance's contents. The wrapper keeps its
  // height either way, so filling it shifts nothing.
  if (isPending) return <StripBand duration={0}>{null}</StripBand>;

  const items: StripItem[] =
    showcase.length > 0
      ? showcase.map((entry) => ({
          key: entry.id,
          title: entry.title,
          kind: entry.kind,
          coverUrl: entry.coverUrl,
        }))
      : FALLBACK_STRIP.map((entry) => ({ ...entry, key: entry.title, coverUrl: null }));

  // A three-title instance would otherwise loop visibly every few seconds.
  // `Math.ceil` over a known-non-empty list rather than a while-loop: the
  // fallback guarantees `items` is never empty, but nothing should depend on
  // that invariant holding to avoid spinning forever.
  const repeats = Math.max(1, Math.ceil(MIN_TILES / items.length));
  const padded: StripItem[] = Array.from({ length: repeats }, () => items).flat();

  return (
    <StripBand duration={padded.length * SECONDS_PER_TILE}>
      {/* Twice, so -50% lands copy two exactly where copy one started. */}
      {[0, 1].map((copy) =>
        padded.map((item, index) => (
          <div
            key={`${copy}-${index}-${item.key}`}
            // `mr-0.5`, not `gap-0.5` on the track: a gap applies *between*
            // tiles, so one copy of the list measures N·w + (N−1)·gap while
            // the -50% slide covers N·w + (N−0.5)·gap — half a gap of drift,
            // and a visible hitch, every time the loop restarts. Folding the
            // gap into each tile makes every tile exactly w+gap wide and the
            // two halves exactly equal.
            className="mr-0.5 flex h-[190px] w-[130px] shrink-0 items-start bg-cover bg-center p-2.5 sm:w-[150px]"
            style={
              item.coverUrl
                ? { backgroundImage: `url(${item.coverUrl})` }
                : { background: coverGradient(item.kind, item.title) }
            }
          >
            {/* Real artwork carries its own title; the gradient has nothing else. */}
            {!item.coverUrl && (
              <span className="font-display text-[13px] leading-[1.1] text-white/90 uppercase">
                {item.title}
              </span>
            )}
          </div>
        )),
      )}
    </StripBand>
  );
}

/**
 * The band's frame: the rotated, viewport-overflowing clip window and the
 * rolling track inside it. Held apart from its contents so the loading state
 * reserves exactly the same box the filled one occupies.
 */
function StripBand({ duration, children }: { duration: number; children: ReactNode }) {
  return (
    <div
      aria-hidden
      className="-mx-20 w-[calc(100%+160px)] translate-y-5 -rotate-2 overflow-hidden"
    >
      <div
        className="marquee h-[190px]"
        style={{ '--marquee-duration': `${duration}s` } as CSSProperties}
      >
        {children}
      </div>
    </div>
  );
}

function Pillars() {
  return (
    <section
      id="pillars"
      className="mx-auto flex max-w-[1360px] flex-col gap-10 px-6 py-20 sm:px-10"
    >
      <h2 className="font-heading text-section uppercase">Why this exists</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {PILLARS.map((pillar) => (
          <GlassCard as="article" key={pillar.num} className="flex flex-col gap-3 p-7">
            <span className="text-prism font-display text-[28px]">{pillar.num}</span>
            <h3 className="text-[17px] font-bold">{pillar.title}</h3>
            <p className="text-sm leading-relaxed text-muted">{pillar.body}</p>
          </GlassCard>
        ))}
      </div>
    </section>
  );
}

function CheckInBand() {
  const [checkedIn, setCheckedIn] = useState(false);
  return (
    <section className="border-y border-divider">
      <div className="mx-auto grid max-w-[1360px] items-center gap-10 px-6 py-20 sm:px-10 lg:grid-cols-2 lg:gap-16">
        <div className="flex flex-col gap-4">
          <h2 className="font-heading text-section uppercase">
            Two taps.
            <br />
            It&apos;s logged.
          </h2>
          <p className="max-w-[440px] leading-relaxed text-muted">
            Per-episode for series and anime, per-chapter for manga and webtoons, rewatch counters,
            precise stats. Speed is a hard requirement, not a feature.
          </p>
        </div>
        <UpNextCard
          kind="anime"
          title="Ashfall Chronicle"
          progressLine="Episode 18 of 24"
          checkedIn={checkedIn}
          onCheckIn={() => setCheckedIn((value) => !value)}
          className="max-w-[460px]"
        />
      </div>
    </section>
  );
}
