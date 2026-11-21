import clsx from 'clsx';
import type { MediaKind } from '@trackt/shared';
import { coverGradient, useShowcase } from '@trackt/client';
import { kindDotClass } from '../ui/KindDot';
import { useLabels } from '../../lib/labels';

/**
 * Placeholder artwork from the design handoff. Light, flat and loud on purpose:
 * nothing drawn over a cover may depend on what the cover looks like. Shown
 * only where this instance's catalog has nothing real to offer.
 */
export const ART = [
  'radial-gradient(90% 60% at 70% 18%, #7c6cf0 0%, transparent 62%), linear-gradient(165deg, #35296b 0%, #0e0c1a 100%)',
  'radial-gradient(80% 50% at 30% 28%, #ffd98a 0%, transparent 66%), linear-gradient(170deg, #c9742a 0%, #3a1a0a 100%)',
  'repeating-linear-gradient(0deg, rgba(255,255,255,0.10) 0 2px, transparent 2px 7px), linear-gradient(160deg, #3a55b0 0%, #080b17 100%)',
  'radial-gradient(70% 45% at 60% 30%, #fff3fa 0%, transparent 70%), linear-gradient(180deg, #f7a8d2 0%, #b84a8c 100%)',
  'linear-gradient(118deg, transparent 0 56%, #c8242b 56% 68%, transparent 68%), linear-gradient(180deg, #f4f0e6 0%, #d8d2c4 100%)',
  'radial-gradient(60% 40% at 50% 38%, #fff7c2 0%, transparent 70%), linear-gradient(180deg, #f2c81e 0%, #e0a80c 100%)',
  'linear-gradient(180deg, #d6eefa 0%, #7dbbe0 48%, #1d4f7a 100%)',
  'radial-gradient(46% 32% at 50% 40%, #e9e4f5 0%, transparent 72%), linear-gradient(180deg, #55309a 0%, #0d0817 100%)',
  'linear-gradient(64deg, transparent 0 44%, rgba(255,255,255,0.85) 44% 47%, transparent 47%), linear-gradient(200deg, #c2202a 0%, #2a0608 78%)',
  'radial-gradient(70% 50% at 40% 62%, #ff9bd0 0%, transparent 70%), linear-gradient(180deg, #1b3a2a 0%, #0a1510 100%)',
  'linear-gradient(180deg, #ece6d6 0%, #b9ae95 58%, #5a5140 100%)',
  'conic-gradient(from 200deg at 62% 38%, #ff7a59, #ffd23f, #35d6c0, #8b5cf6, #ff7a59)',
] as const;

export const art = (index: number): string => ART[index % ART.length]!;

interface WallTile {
  key: string;
  kind: MediaKind;
  coverUrl: string | null;
  background: string;
}

/** The design's wall, as [art, kind] per column: the fallback for an empty catalog. */
const FALLBACK_WALL: [number, MediaKind][][] = [
  [
    [0, 'series'],
    [5, 'anime'],
    [4, 'manga'],
    [11, 'game'],
    [2, 'movie'],
  ],
  [
    [3, 'webtoon'],
    [8, 'manga'],
    [6, 'series'],
    [1, 'anime'],
    [7, 'movie'],
  ],
  [
    [9, 'anime'],
    [10, 'series'],
    [11, 'game'],
    [4, 'manga'],
    [3, 'webtoon'],
  ],
];

/** Fewer than this per column and the loop repeats itself where the eye can see it. */
const MIN_PER_COLUMN = 5;

/** Neighbouring columns drift in opposite directions at different speeds. */
const COLUMN_MOTION = ['wall-up', 'wall-down', 'wall-up wall-slow', 'wall-down wall-slow'] as const;

export type WallColumnCount = 3 | 4;

const GRID_COLUMNS: Record<WallColumnCount, string> = {
  3: 'grid-cols-3',
  4: 'grid-cols-4',
};

/** Deals tiles round-robin into `count` columns, repeating them until each column is long enough. */
function wallColumns(
  showcase: ReturnType<typeof useShowcase>['data'],
  count: WallColumnCount,
): WallTile[][] {
  const tiles: WallTile[] =
    showcase.length > 0
      ? showcase.map((entry) => ({
          key: entry.id,
          kind: entry.kind,
          coverUrl: entry.coverUrl,
          background: coverGradient(entry.kind, entry.title),
        }))
      : FALLBACK_WALL.flat().map(([index, kind], i) => ({
          key: `fallback-${i}`,
          kind,
          coverUrl: null,
          background: art(index),
        }));
  const perColumn = Math.max(MIN_PER_COLUMN, Math.ceil(tiles.length / count));
  const padded = Array.from({ length: perColumn * count }, (_, i) => tiles[i % tiles.length]!);
  return Array.from({ length: count }, (_, c) => padded.filter((_, i) => i % count === c));
}

/**
 * Three tilted columns of what this instance carries, drifting past: the
 * landing hero's wall and the auth pages' backdrop. Position it with
 * `className`; the parent clips it.
 *
 * Deliberately not links and `aria-hidden`: every media page is behind
 * `useAuthedPage()`, so a click would land a signed-out visitor on /login.
 * Empty until the catalog answers, so invented titles never flash in front
 * of the real ones.
 */
export function CoverWallColumns({
  columns: count = 3,
  className,
}: {
  columns?: WallColumnCount;
  className?: string;
}) {
  const labels = useLabels();
  const { data: showcase, isPending } = useShowcase();
  const columns = isPending ? [] : wallColumns(showcase, count);
  return (
    <div aria-hidden className={clsx('grid -rotate-7 gap-4', GRID_COLUMNS[count], className)}>
      {columns.map((column, c) => (
        <div key={c} className={clsx('wall-col', COLUMN_MOTION[c])}>
          {/* Twice, so the -50% slide lands copy two where copy one began. */}
          {[0, 1].map((copy) =>
            column.map((tile, i) => (
              <div
                key={`${copy}-${i}-${tile.key}`}
                className="relative mb-4 aspect-[2/3] rounded-cover bg-cover bg-center shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14),0_18px_40px_-20px_rgb(0_0_0/0.9)]"
                style={
                  tile.coverUrl
                    ? { backgroundImage: `url(${tile.coverUrl})` }
                    : { background: tile.background }
                }
              >
                <span className="absolute bottom-2.5 left-2.5 flex items-center gap-1.5 rounded-full bg-on-prism px-2.25 py-1">
                  <span className={clsx('size-1.5 rounded-full', kindDotClass[tile.kind])} />
                  <span className="font-label text-[9px] font-bold tracking-label text-fg">
                    {labels.kindSingular(tile.kind)}
                  </span>
                </span>
              </div>
            )),
          )}
        </div>
      ))}
    </div>
  );
}
