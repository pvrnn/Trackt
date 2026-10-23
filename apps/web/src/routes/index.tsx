import { createFileRoute, Link } from '@tanstack/react-router';
import { AnimatePresence, animate, m, useReducedMotion } from 'motion/react';
import { Trans, useTranslation } from 'react-i18next';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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

/** One tile in the band: the shape both the real catalog and the fallback produce. */
interface StripItem {
  key: string;
  title: string;
  kind: MediaKind;
  coverUrl: string | null;
}

/**
 * The 12 strip titles from the design handoff. No longer what the band shows
 * when the instance has a catalog; they're the fallback for the case that
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

/** Seconds each tile spends crossing the viewport: the band's speed, not its period. */
const SECONDS_PER_TILE = 4;

/** Below this the loop is too short to read as continuous, so pad it by repeating. */
const MIN_TILES = 10;

const PILLARS = [
  { num: '01', title: 'marketing.pillars.one.title', body: 'marketing.pillars.one.body' },
  { num: '02', title: 'marketing.pillars.two.title', body: 'marketing.pillars.two.body' },
  { num: '03', title: 'marketing.pillars.three.title', body: 'marketing.pillars.three.body' },
  { num: '04', title: 'marketing.pillars.four.title', body: 'marketing.pillars.four.body' },
] as const;

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
  const { t } = useTranslation();
  return (
    <section className="overflow-hidden border-b border-divider">
      <div className="mx-auto flex max-w-[1360px] flex-col gap-7 px-6 pt-16 pb-20 sm:px-10 sm:pt-24">
        <p className="text-prism font-label text-[13px] font-semibold tracking-eyebrow">
          {t('marketing.hero.eyebrow')}
        </p>
        <h1 className="max-w-[1000px] font-heading text-hero uppercase">
          {t('marketing.hero.titleTop')}
          <br />
          <Trans
            i18nKey="marketing.hero.titleBottom"
            components={{ accent: <span className="text-prism" /> }}
          />
        </h1>
        <p className="max-w-[560px] text-[17px] leading-relaxed text-muted sm:text-[19px]">
          {t('marketing.hero.body')}
        </p>
        <div className="flex flex-wrap gap-3.5">
          <MotionLink
            to="/register"
            whileTap={{ scale: 0.97 }}
            className={buttonClassName({ variant: 'primary', size: 'lg' })}
          >
            {t('marketing.hero.start')}
          </MotionLink>
          {/* The TV Time importer (PRD §3.6) hasn't shipped, visibly inert, not a
              disguised register link. */}
          <Tooltip label={t('marketing.hero.importTooltip')}>
            <span
              tabIndex={0}
              className="inline-flex cursor-not-allowed items-center justify-center gap-2 rounded-full border border-glass-border bg-glass px-8 py-4 font-sans text-sm font-bold tracking-btn text-muted"
            >
              {t('marketing.hero.importSoon')}
            </span>
          </Tooltip>
        </div>
        <p className="font-label text-[13px] text-dim">
          {t('marketing.hero.selfHost')}{' '}
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
 * a click from here would land a signed-out visitor on /login, a decorative
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
  // invented titles get replaced by the real catalog a moment later: a flash
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
            // the -50% slide covers N·w + (N−0.5)·gap, which is half a gap of drift and
            // a visible hitch every time the loop restarts. Folding the
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
 *
 * The roll is driven by Motion rather than CSS keyframes so it can be paused
 * mid-flight: `animate` returns controls that resume exactly where they left
 * off, which a class swap cannot do without jumping. Percentages resolve
 * against the track's own width, and the track holds its contents twice, so
 * `-50%` lands copy two precisely where copy one began.
 */
function StripBand({ duration, children }: { duration: number; children: ReactNode }) {
  const track = useRef<HTMLDivElement>(null);
  const roll = useRef<ReturnType<typeof animate> | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const element = track.current;
    // `duration` is 0 while the catalog is still answering; a zero-length loop
    // would spin the track instead of rolling it, so there is no roll yet.
    if (!element || duration <= 0 || reduced) return;
    const controls = animate(
      element,
      { x: ['0%', '-50%'] },
      { duration, ease: 'linear', repeat: Infinity },
    );
    roll.current = controls;
    return () => {
      controls.stop();
      roll.current = null;
    };
  }, [duration, reduced]);

  return (
    <div
      aria-hidden
      className="-mx-20 w-[calc(100%+160px)] translate-y-5 -rotate-2 overflow-hidden"
    >
      <m.div
        ref={track}
        // Pausing on hover is the one nod to control: it lets someone actually
        // read a title they recognised, without turning decoration into a
        // carousel widget.
        onPointerEnter={() => roll.current?.pause()}
        onPointerLeave={() => roll.current?.play()}
        className="flex h-[190px] w-max"
      >
        {children}
      </m.div>
    </div>
  );
}

function Pillars() {
  const { t } = useTranslation();
  return (
    <section
      id="pillars"
      className="mx-auto flex max-w-[1360px] flex-col gap-10 px-6 py-20 sm:px-10"
    >
      <h2 className="font-heading text-section uppercase">{t('marketing.pillars.title')}</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {PILLARS.map((pillar) => (
          <GlassCard as="article" key={pillar.num} className="flex flex-col gap-3 p-7">
            <span className="text-prism font-display text-[28px]">{pillar.num}</span>
            <h3 className="text-[17px] font-bold">{t(pillar.title)}</h3>
            <p className="text-sm leading-relaxed text-muted">{t(pillar.body)}</p>
          </GlassCard>
        ))}
      </div>
    </section>
  );
}

/**
 * The four titles the landing demo cycles through: the same invented cast as
 * the strip fallback, so the page keeps telling one story about one catalog
 * rather than introducing a second, unrelated set of names.
 */
const CHECK_IN_DEMO: { kind: MediaKind; title: string; next: number; total: number }[] = [
  { kind: 'anime', title: 'Ashfall Chronicle', next: 18, total: 24 },
  { kind: 'series', title: 'Neon Harbor', next: 5, total: 10 },
  { kind: 'manga', title: 'Paper Cities', next: 42, total: 61 },
  { kind: 'webtoon', title: 'Moonlit Courier', next: 7, total: 120 },
];

/**
 * How long each beat of the demo holds: reading the card, the press, then the
 * logged state before the next title slides in. Tuned so one title takes about
 * three seconds: long enough to follow, short enough that the loop is not a
 * wait.
 */
const DEMO_HOLD_MS = { idle: 900, checking: 420, logged: 1100 } as const;

const DEMO_CARD_TRANSITION = { duration: 0.3, ease: 'easeOut' } as const;

type DemoPhase = keyof typeof DEMO_HOLD_MS;

/**
 * The card beside the heading, checking itself in on a loop: read the title,
 * press, the log lands, then the next title takes its place.
 *
 * Timers rather than `animate` completion callbacks, because the beat that
 * matters (how long the logged state is readable) is a design decision, not
 * the length of a transition. Clicking the pill still works and jumps to the
 * next beat, so the card never feels like a video someone else is driving.
 * Reduced motion stops the loop at the first title instead of animating a
 * sequence nobody asked to watch.
 */
function CheckInDemo() {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<DemoPhase>('idle');
  const entry = CHECK_IN_DEMO[index] ?? CHECK_IN_DEMO[0]!;
  const progressLine =
    entry.kind === 'manga' || entry.kind === 'webtoon'
      ? t('marketing.checkIn.chapterOf', { next: entry.next, total: entry.total })
      : t('marketing.checkIn.episodeOf', { next: entry.next, total: entry.total });

  const advance = useCallback(() => {
    setPhase('idle');
    setIndex((current) => (current + 1) % CHECK_IN_DEMO.length);
  }, []);

  useEffect(() => {
    if (reduced) return;
    const timer = setTimeout(() => {
      if (phase === 'idle') setPhase('checking');
      else if (phase === 'checking') setPhase('logged');
      else advance();
    }, DEMO_HOLD_MS[phase]);
    return () => clearTimeout(timer);
  }, [phase, reduced, advance]);

  return (
    <div className="max-w-[460px]">
      <AnimatePresence mode="wait" initial={false}>
        <m.div
          key={index}
          initial={{ opacity: 0, y: 18, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: phase === 'checking' ? 0.98 : 1 }}
          exit={{ opacity: 0, y: -18, scale: 0.97 }}
          transition={DEMO_CARD_TRANSITION}
        >
          <UpNextCard
            kind={entry.kind}
            title={entry.title}
            progressLine={progressLine}
            checkedIn={phase === 'logged'}
            onCheckIn={() => (phase === 'logged' ? advance() : setPhase('logged'))}
          />
        </m.div>
      </AnimatePresence>
    </div>
  );
}

function CheckInBand() {
  const { t } = useTranslation();
  return (
    <section className="border-y border-divider">
      <div className="mx-auto grid max-w-[1360px] items-center gap-10 px-6 py-20 sm:px-10 lg:grid-cols-2 lg:gap-16">
        <div className="flex flex-col gap-4">
          <h2 className="font-heading text-section uppercase">
            {t('marketing.checkIn.titleTop')}
            <br />
            {t('marketing.checkIn.titleBottom')}
          </h2>
          <p className="max-w-[440px] leading-relaxed text-muted">{t('marketing.checkIn.body')}</p>
        </div>
        <CheckInDemo />
      </div>
    </section>
  );
}
