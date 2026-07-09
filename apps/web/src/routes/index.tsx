import { createFileRoute, Link } from '@tanstack/react-router';
import { m } from 'motion/react';
import { useState } from 'react';
import type { MediaKind } from '@trackt/shared';
import { AuraBackground } from '../components/layout/AuraBackground';
import { MarketingFooter } from '../components/layout/MarketingFooter';
import { MarketingNav } from '../components/layout/MarketingNav';
import { UpNextCard } from '../components/media/UpNextCard';
import { buttonClassName } from '../components/ui/Button';
import { GlassCard } from '../components/ui/GlassCard';
import { coverGradient } from '../lib/cover';

const MotionLink = m.create(Link);

export const Route = createFileRoute('/')({
  component: Landing,
});

/** The 12 strip titles from the design handoff, mapped to kinds for the cover generator. */
const STRIP: { title: string; kind: MediaKind }[] = [
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
        <h1 className="max-w-[1000px] font-display text-hero uppercase">
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
          <MotionLink
            to="/register"
            whileTap={{ scale: 0.97 }}
            className={buttonClassName({ variant: 'secondary', size: 'lg' })}
          >
            IMPORT FROM TV TIME
          </MotionLink>
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

function CoverStrip() {
  return (
    <div className="-mx-20 flex w-[calc(100%+160px)] translate-y-5 -rotate-2 gap-0.5">
      {STRIP.map(({ title, kind }) => (
        <div
          key={title}
          className="flex h-[190px] min-w-[110px] flex-1 items-start p-2.5"
          style={{ background: coverGradient(kind, title) }}
        >
          <span className="font-display text-[13px] leading-[1.1] text-white/90 uppercase">
            {title}
          </span>
        </div>
      ))}
    </div>
  );
}

function Pillars() {
  return (
    <section
      id="pillars"
      className="mx-auto flex max-w-[1360px] flex-col gap-10 px-6 py-20 sm:px-10"
    >
      <h2 className="font-display text-section uppercase">Why this exists</h2>
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
          <h2 className="font-display text-section uppercase">
            Two taps.
            <br />
            You&apos;re checked in.
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
