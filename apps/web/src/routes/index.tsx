import { createFileRoute, Link } from '@tanstack/react-router';
import { m, useReducedMotion } from 'motion/react';
import { Trans, useTranslation } from 'react-i18next';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { ArrowRight, ArrowUpRight, Check, EyeOff, Hash } from 'lucide-react';
import { MEDIA_KINDS, type MediaKind, type NewsTopic } from '@trackt/shared';
import { coverGradient, useNewsFeed, useShowcase } from '@trackt/client';
import { AuraBackground } from '../components/layout/AuraBackground';
import { MarketingFooter } from '../components/layout/MarketingFooter';
import { MarketingNav } from '../components/layout/MarketingNav';
import { art, CoverWallColumns } from '../components/marketing/CoverWall';
import { BrandMark, BrandTile, brandTitle, type Brand } from '../components/ui/BrandLogo';
import { buttonClassName } from '../components/ui/Button';
import { GlassCard } from '../components/ui/GlassCard';
import { kindDotClass } from '../components/ui/KindDot';
import { useLabels } from '../lib/labels';

const MotionLink = m.create(Link);

export const Route = createFileRoute('/')({
  component: Landing,
});

const GITHUB_URL = 'https://github.com/pvrnn/Trackt';
const DISCORD_URL = `${GITHUB_URL}/tree/main/apps/discord`;

/** A title the demos can show: the instance's own, or the design's invented one. */
interface Showpiece {
  title: string;
  kind: MediaKind;
  coverUrl: string | null;
  /** What to paint when there is no cover. */
  background: string;
}

/** The design's cast, one per kind: what a demo shows on a catalog that lacks the kind. */
const FALLBACK_PIECES: Record<MediaKind, { title: string; art: number }> = {
  movie: { title: 'The Long Static', art: 2 },
  series: { title: 'Neon Harbor', art: 0 },
  anime: { title: 'Ashfall Chronicle', art: 1 },
  manga: { title: 'Paper Cities', art: 4 },
  webtoon: { title: 'Moonlit Courier', art: 3 },
  game: { title: 'Tidewalker', art: 11 },
};

/**
 * The landing's demos draw from what this instance actually carries: the same
 * `GET /media/showcase` batch the cover wall uses (one request, shared cache).
 * `piece(kind, n)` is the n-th title of that kind with real artwork, falling
 * back to the design's invented title only when the catalog has none.
 */
function useShowpieces() {
  const { data: showcase, isPending } = useShowcase();
  return useMemo(() => {
    const byKind = new Map<MediaKind, Showpiece[]>();
    for (const entry of showcase) {
      if (!entry.coverUrl) continue;
      const list = byKind.get(entry.kind) ?? [];
      list.push({
        title: entry.title,
        kind: entry.kind,
        coverUrl: entry.coverUrl,
        background: coverGradient(entry.kind, entry.title),
      });
      byKind.set(entry.kind, list);
    }
    const piece = (kind: MediaKind, index = 0): Showpiece => {
      const real = byKind.get(kind);
      if (real?.length) return real[index % real.length]!;
      const fallback = FALLBACK_PIECES[kind];
      return { title: fallback.title, kind, coverUrl: null, background: art(fallback.art) };
    };
    return { isPending, piece };
  }, [showcase, isPending]);
}

/** A cover-shaped box painted with a showpiece's artwork. */
function Cover({ piece, className }: { piece: Showpiece; className?: string }) {
  return (
    <span
      aria-hidden
      className={clsx(
        'block bg-cover bg-center shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14)]',
        className,
      )}
      style={
        piece.coverUrl
          ? { backgroundImage: `url(${piece.coverUrl})` }
          : { background: piece.background }
      }
    />
  );
}

const AVATAR_WARM = 'bg-[linear-gradient(135deg,#d9a441,#d96bb0)]';
const AVATAR_COOL = 'bg-[linear-gradient(135deg,#a78bfa,#6d8bf0)]';

function Landing() {
  return (
    <>
      <AuraBackground variant="marketing" />
      <div className="relative overflow-x-clip">
        <MarketingNav />
        <Hero />
        <Kinds />
        <Features />
        <Import />
        <Discord />
        <Open />
        <Closer />
        <MarketingFooter />
      </div>
    </>
  );
}

function Section({
  id,
  band = false,
  className,
  children,
}: {
  id?: string;
  band?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={clsx(band && 'border-y border-divider bg-ink/35')}>
      <div className={clsx('mx-auto max-w-[1360px] px-5 py-20 sm:px-10 sm:py-22', className)}>
        {children}
      </div>
    </section>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="m-0 font-display text-[clamp(2.75rem,5.6vw,4.5rem)] leading-[0.95] font-normal uppercase">
      {children}
    </h2>
  );
}

/** Heading on the left, a short paragraph beside it, bottoms aligned. */
function SectionHead({ title, body }: { title: ReactNode; body: string }) {
  return (
    <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
      <SectionTitle>{title}</SectionTitle>
      <p className="mb-1.5 max-w-[460px] text-[17px] leading-relaxed text-pretty text-muted">
        {body}
      </p>
    </div>
  );
}

/** A secondary pill with a trailing icon, for links that leave the page. */
function OutLink({
  href,
  brand,
  children,
  size = 'md',
}: {
  href: string;
  brand?: Brand;
  children: ReactNode;
  size?: 'md' | 'lg';
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={buttonClassName({
        variant: 'secondary',
        size,
        className: size === 'lg' ? 'px-7 py-4.25' : 'px-6.5 py-3.5',
      })}
    >
      {brand && <BrandMark brand={brand} className="size-4" />}
      {children}
      <ArrowUpRight aria-hidden className="size-4" strokeWidth={2.4} />
    </a>
  );
}

const WORD_INTERVAL_MS = 4000;

/** The kind the hero is currently naming; stays on the first under reduced motion. */
function useRotatingKind(): number {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const timer = setInterval(
      () => setIndex((current) => (current + 1) % MEDIA_KINDS.length),
      WORD_INTERVAL_MS,
    );
    return () => clearInterval(timer);
  }, [reduced]);
  return index;
}

function Hero() {
  const { t } = useTranslation();
  const labels = useLabels();
  const active = useRotatingKind();
  const previous = (active + MEDIA_KINDS.length - 1) % MEDIA_KINDS.length;

  return (
    <header className="relative overflow-hidden">
      <div className="mx-auto grid max-w-[1360px] items-center gap-x-12 gap-y-6 px-5 sm:px-10 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-6.5 pt-18 lg:pb-20">
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {MEDIA_KINDS.map((kind, index) => (
              <span key={kind} className="flex items-center gap-1.75">
                <span aria-hidden className={clsx('size-1.75 rounded-full', kindDotClass[kind])} />
                <span
                  className={clsx(
                    'font-label text-xs font-bold tracking-[0.12em] transition-colors duration-300',
                    index === active ? 'text-fg' : 'text-dim',
                  )}
                >
                  {labels.kind(kind)}
                </span>
              </span>
            ))}
          </div>

          <h1
            aria-label={t('marketing.hero.label')}
            className="m-0 font-display text-[clamp(4rem,9.4vw,8.25rem)] leading-[0.92] font-normal uppercase"
          >
            <span aria-hidden className="block">
              {t('marketing.hero.titleTop')}
            </span>
            {/* Every word stacked in one grid cell, so the line is as wide as the widest. */}
            <span aria-hidden className="grid">
              {MEDIA_KINDS.map((kind, index) => (
                <span
                  key={kind}
                  className={clsx(
                    'text-prism whitespace-nowrap transition-[opacity,transform] duration-900 ease-[cubic-bezier(0.22,1,0.36,1)] [grid-area:1/1] motion-reduce:transition-none',
                    index === active
                      ? 'translate-y-0 opacity-100'
                      : index === previous
                        ? '-translate-y-[35%] opacity-0'
                        : 'translate-y-[35%] opacity-0',
                  )}
                >
                  {t(`marketing.hero.word.${kind}`)}
                </span>
              ))}
            </span>
          </h1>

          <p className="max-w-[520px] text-[19px] leading-relaxed text-pretty text-[#cfc9d8]">
            {t('marketing.hero.body')}
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <MotionLink
              to="/register"
              whileTap={{ scale: 0.97 }}
              className={buttonClassName({ size: 'lg', className: 'px-8.5 py-4.25' })}
            >
              {t('marketing.hero.start')}
            </MotionLink>
            <OutLink href={GITHUB_URL} brand="github" size="lg">
              {t('marketing.hero.github')}
            </OutLink>
          </div>
          <p className="font-label text-xs font-medium tracking-btn text-dim">
            <Trans
              i18nKey="marketing.hero.proof"
              components={{
                import: (
                  <a
                    href="#import"
                    className="text-muted underline underline-offset-3 hover:text-pink"
                  />
                ),
              }}
            />
          </p>
        </div>

        <CoverWall />
      </div>
    </header>
  );
}

/** The hero's wall, with two moments from the app floating over it once the catalog answers. */
function CoverWall() {
  const { t } = useTranslation();
  const { isPending } = useShowcase();
  const { piece } = useShowpieces();
  return (
    <div
      aria-hidden
      className="relative h-[480px] min-w-0 [mask-image:linear-gradient(180deg,transparent_0%,#000_16%,#000_80%,transparent_100%)] lg:h-[680px]"
    >
      <CoverWallColumns className="absolute -inset-x-10 -inset-y-30" />
      <div className="absolute inset-y-0 left-0 hidden w-[110px] bg-linear-to-r from-ink to-transparent lg:block" />

      {!isPending && (
        <>
          <div className="float-chip absolute top-[30%] left-[4%] flex max-w-[70%] items-center gap-3 rounded-full bg-[#191520] py-3 pr-4.5 pl-3 shadow-[inset_0_0_0_1px_rgb(217_107_176/0.55),0_24px_50px_-18px_rgb(0_0_0/0.9)]">
            <span className="flex size-8.5 shrink-0 items-center justify-center rounded-full bg-prism text-on-prism">
              <Check className="size-4.5" strokeWidth={3} />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-bold">{t('marketing.hero.checkedIn')}</span>
              <span className="truncate font-label text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">
                {piece('series').title} · E5
              </span>
            </span>
          </div>
          <div className="float-chip float-chip-late absolute top-[58%] right-[6%] flex max-w-[70%] items-center gap-3 rounded-[18px] bg-[#191520] px-4.5 py-3 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14),0_24px_50px_-18px_rgb(0_0_0/0.9)]">
            <span className="text-prism font-display text-[34px] leading-none">9.0</span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-bold">
                {t('marketing.hero.finished', { user: 'rex' })}
              </span>
              <span className="truncate font-label text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">
                {piece('movie').title}
              </span>
            </span>
          </div>
        </>
      )}
    </div>
  );
}

/** How far along each kind's sample reads, as the bar under it. */
const KIND_PROGRESS: Record<MediaKind, number> = {
  movie: 100,
  series: 38,
  anime: 75,
  manga: 62,
  webtoon: 84,
  game: 45,
};

function Kinds() {
  const { t } = useTranslation();
  const labels = useLabels();
  const { isPending, piece } = useShowpieces();
  return (
    <Section className="flex flex-col gap-9 pt-18">
      <SectionHead
        title={
          <>
            {t('marketing.kinds.titleTop')}
            <br />
            {t('marketing.kinds.titleBottom')}
          </>
        }
        body={t('marketing.kinds.body')}
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {MEDIA_KINDS.map((kind) => {
          const shown = piece(kind);
          return (
            <GlassCard
              as="article"
              key={kind}
              className="landing-tile flex min-w-0 items-stretch gap-5 rounded-[18px] p-6"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={clsx('size-2.25 rounded-full', kindDotClass[kind])}
                  />
                  <h3 className="m-0 font-display text-[30px] leading-none font-normal uppercase">
                    {labels.kind(kind)}
                  </h3>
                </div>
                <p className="text-[15px] leading-normal text-muted">
                  {t(`marketing.kinds.how.${kind}`)}
                </p>
                <span className="min-h-2 flex-1" />
                <p
                  className={clsx(
                    'truncate font-label text-[11px] font-bold tracking-[0.08em] text-fg uppercase transition-opacity',
                    isPending && 'opacity-0',
                  )}
                >
                  {t(`marketing.kinds.sample.${kind}`, { title: shown.title })}
                </p>
                <div aria-hidden className="h-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-prism"
                    style={{ width: `${KIND_PROGRESS[kind]}%` }}
                  />
                </div>
              </div>
              <Cover
                piece={shown}
                className={clsx(
                  'aspect-[2/3] w-21 shrink-0 rotate-3 self-center rounded-[9px] transition-opacity',
                  isPending && 'opacity-0',
                )}
              />
            </GlassCard>
          );
        })}
      </div>
    </Section>
  );
}

function FeatureCard({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <GlassCard as="article" className="flex min-w-0 flex-col gap-3.5 rounded-[18px] p-7">
      <h3 className="m-0 font-display text-[34px] leading-none font-normal uppercase">{title}</h3>
      <p className="max-w-[46ch] leading-relaxed text-muted">{body}</p>
      <span className="min-h-1.5 flex-1" />
      {children}
    </GlassCard>
  );
}

/** A mock surface inside a feature card: opaque, so it reads as the app, not glass. */
const MOCK_SURFACE = 'bg-[#17131d] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1)]';

function Features() {
  const { t } = useTranslation();
  return (
    <Section band className="flex flex-col gap-9">
      <SectionTitle>{t('marketing.features.title')}</SectionTitle>
      <div className="grid gap-4 lg:grid-cols-2">
        <FeatureCard
          title={t('marketing.features.checkIn.title')}
          body={t('marketing.features.checkIn.body')}
        >
          <CheckInDemo />
        </FeatureCard>
        <FeatureCard
          title={t('marketing.features.friends.title')}
          body={t('marketing.features.friends.body')}
        >
          <FriendsDemo />
        </FeatureCard>
        <FeatureCard
          title={t('marketing.features.news.title')}
          body={t('marketing.features.news.body')}
        >
          <NewsDemo />
        </FeatureCard>
        <FeatureCard
          title={t('marketing.features.profile.title')}
          body={t('marketing.features.profile.body')}
        >
          <ProfileDemo />
        </FeatureCard>
      </div>
    </Section>
  );
}

const DEMO_EPISODE = { next: 5, total: 12 };

function CheckInDemo() {
  const { t } = useTranslation();
  const labels = useLabels();
  const { piece } = useShowpieces();
  const [done, setDone] = useState(false);
  const shown = piece('anime');
  const progress = ((DEMO_EPISODE.next - (done ? 0 : 1)) / DEMO_EPISODE.total) * 100;

  return (
    <div
      className={clsx(
        'flex max-w-[420px] items-center gap-3.5 rounded-card-sm bg-[#17131d] py-2.5 pr-3.5 pl-2.5 transition-shadow duration-200',
        done
          ? 'shadow-[inset_0_0_0_1px_rgb(217_107_176/0.55)]'
          : 'shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1)]',
      )}
    >
      <Cover piece={shown} className="h-[81px] w-[54px] shrink-0 rounded-[7px]" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className={clsx('size-1.5 rounded-full', kindDotClass.anime)} />
          <span className="font-label text-[10px] font-bold tracking-label text-dim">
            {labels.kindSingular('anime')}
          </span>
        </span>
        <span className="truncate text-[15px] font-bold">{shown.title}</span>
        <span className="text-[13px] text-muted">
          {done
            ? t('marketing.features.checkIn.done', { next: DEMO_EPISODE.next + 1 })
            : t('marketing.features.checkIn.next', DEMO_EPISODE)}
        </span>
        <span aria-hidden className="mt-0.75 h-0.75 overflow-hidden rounded-full bg-white/10">
          <span
            className="block h-full rounded-full bg-prism transition-[width] duration-400"
            style={{ width: `${progress}%` }}
          />
        </span>
      </div>
      <m.button
        type="button"
        whileTap={{ scale: 0.92 }}
        onClick={() => setDone((current) => !current)}
        aria-pressed={done}
        aria-label={t('marketing.features.checkIn.action', { title: shown.title })}
        className={clsx(
          'flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-full transition hover:brightness-115',
          done
            ? 'bg-pink/16 text-[#e58cc4] shadow-[inset_0_0_0_1px_rgb(217_107_176/0.6)]'
            : 'bg-prism text-on-prism',
        )}
      >
        <Check aria-hidden className="size-5" strokeWidth={3} />
      </m.button>
    </div>
  );
}

const STRONG = <b className="font-semibold text-fg" />;
const SCORE = <span className="font-bold text-[#e58cc4]" />;

function FriendsDemo() {
  const { t } = useTranslation();
  const { piece } = useShowpieces();
  const rated = piece('series');
  const spoiled = piece('series', 1);
  return (
    <div className="flex flex-col gap-2">
      <div className={clsx('flex items-center gap-3 rounded-xl px-3.5 py-3', MOCK_SURFACE)}>
        <Initial className={AVATAR_WARM}>J</Initial>
        <p className="min-w-0 flex-1 text-sm leading-[1.45] text-muted">
          <Trans
            i18nKey="marketing.features.friends.rated"
            values={{ user: 'june_k', title: rated.title, unit: 'E4', score: '9.0' }}
            components={{ b: STRONG, score: SCORE }}
          />
        </p>
        <Cover piece={rated} className="h-11 w-7.5 shrink-0 rounded-[4px]" />
      </div>
      <div className={clsx('flex items-center gap-3 rounded-xl px-3.5 py-3', MOCK_SURFACE)}>
        <Initial className={AVATAR_COOL}>R</Initial>
        <p className="min-w-0 flex-1 text-sm leading-[1.45] text-muted">
          <Trans
            i18nKey="marketing.features.friends.spoiler"
            values={{ user: 'rex', unit: `${spoiled.title} E6` }}
            components={{
              b: STRONG,
              spoiler: (
                <span className="cursor-pointer text-fg blur-[5px] transition hover:blur-none" />
              ),
            }}
          />{' '}
          <span className="inline-flex items-center gap-1 align-middle font-label text-[10px] font-bold tracking-label text-[#e58cc4]">
            <EyeOff aria-hidden className="size-3" strokeWidth={2.4} />
            {t('marketing.features.friends.spoilerTag')}
          </span>
        </p>
        <Cover piece={spoiled} className="h-11 w-7.5 shrink-0 rounded-[4px]" />
      </div>
    </div>
  );
}

function Initial({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span
      aria-hidden
      className={clsx(
        'flex size-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-on-prism',
        className,
      )}
    >
      {children}
    </span>
  );
}

const TOPIC_TONE: Partial<Record<NewsTopic, string>> = {
  renewal: 'bg-pink/18 text-[#e58cc4]',
  release_date: 'bg-kind-series/20 text-[#8fa5f0]',
  adaptation: 'bg-gold/18 text-gold',
  trailer: 'bg-kind-movie/20 text-[#b9a2fb]',
};

/**
 * The instance's two latest stories, linked: news is public (ADR-0005), so a
 * signed-out visitor can follow one. The design's two briefs stand in only
 * when the feed has nothing yet.
 */
function NewsDemo() {
  const { t } = useTranslation();
  const labels = useLabels();
  const { piece } = useShowpieces();
  const { articles, isLoading } = useNewsFeed({});

  const stories =
    articles.length > 0
      ? articles.slice(0, 2).map((article, i) => ({
          key: article.id,
          slug: article.slug as string | null,
          topic: article.topic,
          headline: article.title,
          cover: article.coverUrl
            ? { ...piece(article.kinds[0] ?? 'series', i), coverUrl: article.coverUrl }
            : piece(article.kinds[0] ?? 'series', i),
        }))
      : [
          {
            key: 'renewal',
            slug: null,
            topic: 'renewal' as const,
            headline: t('marketing.features.news.renewed'),
            cover: { ...piece('series'), coverUrl: null, background: art(0) },
          },
          {
            key: 'premiere',
            slug: null,
            topic: 'release_date' as const,
            headline: t('marketing.features.news.premiere'),
            cover: { ...piece('anime'), coverUrl: null, background: art(1) },
          },
        ];

  return (
    <ul className={clsx('m-0 flex list-none flex-col p-0', isLoading && 'opacity-0')}>
      {stories.map((story) => {
        const body = (
          <>
            <Cover piece={story.cover} className="h-[57px] w-[38px] shrink-0 rounded-[5px]" />
            <span className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
              <span
                className={clsx(
                  'rounded-full px-2.5 py-0.75 font-label text-[10px] font-bold tracking-label',
                  TOPIC_TONE[story.topic] ?? 'bg-white/10 text-muted',
                )}
              >
                {labels.topic(story.topic)}
              </span>
              <span className="text-[15px] leading-[1.3] font-semibold">{story.headline}</span>
            </span>
          </>
        );
        return (
          <li key={story.key} className="border-t border-white/8">
            {story.slug ? (
              <Link
                to="/news/$slug"
                params={{ slug: story.slug }}
                className="group flex items-center gap-3.5 py-3 hover:text-pink"
              >
                {body}
                <ArrowRight
                  aria-hidden
                  className="size-4 shrink-0 text-dim transition group-hover:translate-x-0.5 group-hover:text-pink"
                />
              </Link>
            ) : (
              <div className="flex items-center gap-3.5 py-3">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Share of time per kind in the profile demo, largest first. */
const TIME_SPLIT: [MediaKind, number][] = [
  ['series', 34],
  ['anime', 27],
  ['manga', 21],
  ['webtoon', 9],
  ['movie', 6],
  ['game', 3],
];

function ProfileDemo() {
  const { t } = useTranslation();
  const labels = useLabels();
  const { piece } = useShowpieces();
  const legend = TIME_SPLIT.slice(0, 3)
    .map(([kind, pct]) => `${labels.kindSingular(kind)} ${pct}%`)
    .concat('…')
    .join(' · ');
  return (
    <div className="flex flex-wrap items-end gap-5">
      {/* Top pick in every kind: one cover each. */}
      <div aria-hidden className="flex gap-2">
        {MEDIA_KINDS.map((kind) => (
          <Cover key={kind} piece={piece(kind)} className="aspect-[2/3] w-[46px] rounded-thumb" />
        ))}
      </div>
      <div className="flex min-w-[200px] flex-1 flex-col gap-2">
        <span className="font-label text-[10px] font-bold tracking-[0.12em] text-dim">
          {t('marketing.features.profile.time')}
        </span>
        <span aria-hidden className="flex h-2.5 gap-0.5">
          {TIME_SPLIT.map(([kind, pct]) => (
            <span
              key={kind}
              className={clsx('min-w-1 rounded-[3px]', kindDotClass[kind])}
              style={{ flex: `${pct} 1 0` }}
            />
          ))}
        </span>
        <span className="font-label text-[11px] font-semibold tracking-btn text-muted">
          {legend}
        </span>
      </div>
    </div>
  );
}

/** The importers `@trackt/imports` ships, with the kinds each can yield. */
const IMPORT_SOURCES: { brand: Brand; kinds: MediaKind[] }[] = [
  { brand: 'letterboxd', kinds: ['movie'] },
  { brand: 'myanimelist', kinds: ['anime', 'manga'] },
  { brand: 'anilist', kinds: ['anime', 'manga'] },
  { brand: 'trakt', kinds: ['series', 'movie'] },
  { brand: 'steam', kinds: ['game'] },
];

function Import() {
  const { t } = useTranslation();
  const labels = useLabels();
  return (
    <Section id="import" className="flex flex-col gap-9">
      <SectionHead
        title={
          <>
            {t('marketing.import.titleTop')}
            <br />
            {t('marketing.import.titleBottom')}
          </>
        }
        body={t('marketing.import.body')}
      />
      <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))]">
        {IMPORT_SOURCES.map((source) => (
          <GlassCard
            as="li"
            key={source.brand}
            className="landing-tile flex min-w-0 flex-col gap-4 rounded-[18px] p-5.5"
          >
            <BrandTile brand={source.brand} className="size-14 rounded-card-sm" />
            <div className="flex flex-col gap-2">
              <h3 className="m-0 text-[19px] leading-[1.2] font-bold">
                {brandTitle(source.brand)}
              </h3>
              <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                {source.kinds.map((kind) => (
                  <span key={kind} className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className={clsx('size-1.5 rounded-full', kindDotClass[kind])}
                    />
                    <span className="font-label text-[11px] font-bold tracking-label text-muted">
                      {labels.kind(kind)}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          </GlassCard>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <MotionLink
          to="/register"
          whileTap={{ scale: 0.97 }}
          className={buttonClassName({ variant: 'secondary', className: 'px-6.5 py-3.5' })}
        >
          {t('marketing.import.cta')}
          <ArrowRight aria-hidden className="size-4" strokeWidth={2.4} />
        </MotionLink>
        <span className="font-label text-xs font-medium tracking-btn text-dim">
          {t('marketing.import.note')}
        </span>
      </div>
    </Section>
  );
}

const BOT_FEATURES = ['parties', 'feed', 'commands'] as const;

function Discord() {
  const { t } = useTranslation();
  return (
    <Section
      id="discord"
      band
      className="grid items-center gap-x-16 gap-y-10 lg:grid-cols-[repeat(2,minmax(0,1fr))]"
    >
      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex items-center gap-3">
          <BrandTile brand="discord" className="size-11 rounded-xl" />
          <span className="font-label text-xs font-bold tracking-[0.12em] text-muted">
            {t('marketing.discord.eyebrow')}
          </span>
        </div>
        <SectionTitle>
          {t('marketing.discord.titleTop')}
          <br />
          {t('marketing.discord.titleBottom')}
        </SectionTitle>
        <p className="max-w-[46ch] text-[17px] leading-relaxed text-pretty text-muted">
          {t('marketing.discord.body')}
        </p>
        <dl className="m-0 flex flex-col">
          {BOT_FEATURES.map((feature) => (
            <div
              key={feature}
              className="grid items-baseline gap-5 border-b border-divider py-4 sm:grid-cols-[150px_minmax(0,1fr)]"
            >
              <dt className="font-label text-[11px] font-bold tracking-[0.12em] text-[#e58cc4]">
                {t(`marketing.discord.${feature}.k`)}
              </dt>
              <dd className="m-0 leading-normal text-fg">{t(`marketing.discord.${feature}.v`)}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-1.5 flex">
          <OutLink href={DISCORD_URL} brand="discord">
            {t('marketing.discord.cta')}
          </OutLink>
        </div>
      </div>
      <ChannelDemo />
    </Section>
  );
}

/** A channel in our own vocabulary: a watch party you can join, then what it produced. */
function ChannelDemo() {
  const { t } = useTranslation();
  const { piece } = useShowpieces();
  const [joined, setJoined] = useState(false);
  const party = piece('series', 2);
  return (
    <div className="flex min-w-0 flex-col rounded-[18px] bg-[#17131d] pt-2 pb-3.5 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1),0_40px_80px_-40px_rgb(0_0_0/0.9)]">
      <div className="flex items-center gap-2 border-b border-white/8 px-5 pt-3 pb-3.5">
        <Hash aria-hidden className="size-4 text-dim" strokeWidth={2.6} />
        <span className="font-label text-[13px] font-bold tracking-[0.04em]">watch-party</span>
      </div>
      <BotMessage time="20:41">
        <div className="flex items-center gap-3.5 rounded-card-sm bg-glass p-3 shadow-[inset_0_0_0_1px_rgb(217_107_176/0.45)]">
          <Cover piece={party} className="h-[81px] w-[54px] shrink-0 rounded-[7px]" />
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="font-label text-[10px] font-bold tracking-label text-[#e58cc4]">
              {t('marketing.discord.party')}
            </span>
            <span className="truncate font-bold">{party.title}</span>
            <span className="text-[13px] text-muted">
              {t('marketing.discord.partyMeta', { count: joined ? 5 : 4 })}
            </span>
          </span>
          <m.button
            type="button"
            whileTap={{ scale: 0.95 }}
            onClick={() => setJoined((current) => !current)}
            aria-pressed={joined}
            className={clsx(
              'inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-4.5 py-2.75 text-xs font-bold tracking-btn transition hover:brightness-115',
              joined
                ? 'bg-pink/16 text-[#e58cc4] shadow-[inset_0_0_0_1px_rgb(217_107_176/0.6)]'
                : 'bg-prism text-on-prism',
            )}
          >
            {joined && <Check aria-hidden className="size-3.5" strokeWidth={3} />}
            {joined ? t('marketing.discord.going') : t('marketing.discord.join')}
          </m.button>
        </div>
      </BotMessage>
      <BotMessage time="21:48">
        <p className="text-sm leading-normal text-muted">
          <Trans i18nKey="marketing.discord.over" components={{ b: STRONG, score: SCORE }} />
        </p>
      </BotMessage>
    </div>
  );
}

function BotMessage({ time, children }: { time: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-3 px-5 pt-4 pb-2">
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-prism font-display text-[15px] text-on-prism"
      >
        T
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-bold">Trackt</span>
          <span className="rounded-[4px] bg-muted px-1.25 py-px font-label text-[9px] font-bold tracking-label text-on-prism">
            {t('marketing.discord.bot')}
          </span>
          <span className="font-label text-[11px] text-dim">{time}</span>
        </div>
        {children}
      </div>
    </div>
  );
}

const OPEN_ROWS = ['source', 'data', 'api', 'selfHost'] as const;

function Open() {
  const { t } = useTranslation();
  return (
    <Section id="open" className="grid items-start gap-x-16 gap-y-8 lg:grid-cols-2">
      <div className="flex flex-col gap-4.5">
        <SectionTitle>{t('marketing.open.title')}</SectionTitle>
        <p className="max-w-[46ch] text-[17px] leading-relaxed text-pretty text-muted">
          {t('marketing.open.body')}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-3">
          <OutLink href={GITHUB_URL} brand="github">
            {t('marketing.open.github')}
          </OutLink>
          <a
            href="/docs"
            className="group inline-flex items-center gap-1.5 px-2 py-3.5 font-label text-xs font-bold tracking-[0.08em] text-pink hover:brightness-115"
          >
            {t('marketing.open.docs')}
            <ArrowRight
              aria-hidden
              className="size-3.5 transition group-hover:translate-x-0.5"
              strokeWidth={2.6}
            />
          </a>
        </div>
      </div>
      <dl className="m-0 flex flex-col">
        {OPEN_ROWS.map((row) => (
          <div
            key={row}
            className="grid items-baseline gap-5 border-b border-divider py-4.5 sm:grid-cols-[150px_minmax(0,1fr)]"
          >
            <dt className="font-label text-[11px] font-bold tracking-[0.12em] text-dim">
              {t(`marketing.open.${row}.k`)}
            </dt>
            <dd className="m-0 leading-normal text-fg">
              {t(`marketing.open.${row}.v`)}
              {row === 'selfHost' && (
                <>
                  {' '}
                  <code className="font-label text-[13px] text-[#e58cc4]">docker compose up</code>
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

function Closer() {
  const { t } = useTranslation();
  return (
    <section className="relative overflow-hidden border-t border-divider">
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(600px_300px_at_50%_120%,rgb(217_107_176/0.4),transparent_70%),radial-gradient(500px_280px_at_20%_110%,rgb(217_164_65/0.3),transparent_70%),radial-gradient(500px_280px_at_80%_110%,rgb(139_92_246/0.35),transparent_70%)]"
      />
      <div className="relative mx-auto flex max-w-[1360px] flex-col items-center gap-6.5 px-5 pt-26 pb-28 text-center sm:px-10">
        <h2 className="m-0 font-display text-[clamp(3.5rem,8vw,7rem)] leading-[0.92] font-normal uppercase">
          <Trans
            i18nKey="marketing.closer.title"
            components={{ accent: <span className="text-prism" /> }}
          />
        </h2>
        <p className="max-w-[44ch] text-lg leading-relaxed text-[#cfc9d8]">
          {t('marketing.closer.body')}
        </p>
        <MotionLink
          to="/register"
          whileTap={{ scale: 0.97 }}
          className={buttonClassName({ size: 'lg', className: 'px-9 py-4.25' })}
        >
          {t('marketing.closer.cta')}
        </MotionLink>
      </div>
    </section>
  );
}
