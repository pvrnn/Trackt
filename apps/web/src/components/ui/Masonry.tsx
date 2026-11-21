import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** Grid row unit; a card spans as many as its measured height needs. */
const ROW_PX = 4;
const GAP_PX = 16;
/** Narrowest column before the layout drops one. */
const MIN_COLUMN_PX = 280;
const MAX_COLUMNS = 4;

export interface MasonryProps<T> {
  items: readonly T[];
  itemKey: (item: T) => string;
  /** Height to pack with before an item has been measured. */
  estimate: (item: T) => number;
  children: (item: T) => ReactNode;
}

/**
 * Shortest-column-first packing (`docs/design` › News), so column bottoms level
 * out and recency still reads left to right. Each item is *placed* on a CSS
 * grid rather than moved into a column element, which keeps the DOM, and so tab
 * and screen-reader order, in the order the items came.
 */
export function Masonry<T>({ items, itemKey, estimate, children }: MasonryProps<T>) {
  const container = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(1);
  const [heights, setHeights] = useState<Record<string, number>>({});

  useLayoutEffect(() => {
    const node = container.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0;
      const fit = Math.floor((width + GAP_PX) / (MIN_COLUMN_PX + GAP_PX));
      setColumns(Math.max(1, Math.min(MAX_COLUMNS, fit)));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const node = container.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      setHeights((previous) => {
        let next = previous;
        for (const entry of entries) {
          const key = (entry.target as HTMLElement).dataset.masonryKey;
          const height = Math.ceil(entry.borderBoxSize[0]?.blockSize ?? 0);
          if (!key || !height || previous[key] === height) continue;
          if (next === previous) next = { ...previous };
          next[key] = height;
        }
        return next;
      });
    });
    for (const child of node.querySelectorAll('[data-masonry-key]')) observer.observe(child);
    return () => observer.disconnect();
  }, [items, columns]);

  const tops = Array.from({ length: columns }, () => 0);
  const placed = items.map((item) => {
    const key = itemKey(item);
    const span = Math.ceil(((heights[key] ?? estimate(item)) + GAP_PX) / ROW_PX);
    let column = 0;
    for (let index = 1; index < columns; index += 1) {
      if ((tops[index] ?? 0) < (tops[column] ?? 0)) column = index;
    }
    const start = (tops[column] ?? 0) + 1;
    tops[column] = start - 1 + span;
    return { item, key, column, start, span };
  });

  return (
    <div
      ref={container}
      className="grid items-start"
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gridAutoRows: `${ROW_PX}px`,
        columnGap: GAP_PX,
      }}
    >
      {placed.map(({ item, key, column, start, span }) => (
        <div
          key={key}
          style={{ gridColumn: column + 1, gridRow: `${start} / span ${span}` }}
          className="min-w-0"
        >
          <div data-masonry-key={key}>{children(item)}</div>
        </div>
      ))}
    </div>
  );
}
