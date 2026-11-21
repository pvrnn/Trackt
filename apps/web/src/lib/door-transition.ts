/**
 * The exit from /login and /register: the auth screen splits down the middle
 * and opens like a double door onto the page behind it.
 *
 * The doors are two clones of the auth screen, each clipped to one half, fixed
 * over the viewport. The navigation runs underneath them, so the destination is
 * already rendered when they part. Clones are static: the cover wall's columns
 * are frozen at the offset they had, or they would restart their drift.
 */

const DURATION_MS = 720;
/** Longest the doors stay shut waiting for the destination to draw. */
const READY_TIMEOUT_MS = 4000;
const EASE = 'cubic-bezier(0.65, 0, 0.25, 1)';

let opening = false;

/** True from the moment the doors are built until they are gone. */
export function doorsOpening(): boolean {
  return opening;
}

/**
 * Resolves once the destination has drawn real content, not the blank shell an
 * app page shows while its session resolves: a heading outside the doors.
 */
function destinationReady(stage: HTMLElement): Promise<void> {
  const start = performance.now();
  return new Promise((resolve) => {
    const check = () => {
      const heading = [...document.querySelectorAll('h1')].some(
        (h1) => !stage.contains(h1) && !h1.closest('[data-auth-root]'),
      );
      if (heading || performance.now() - start > READY_TIMEOUT_MS) resolve();
      else requestAnimationFrame(check);
    };
    check();
  });
}

function freeze(original: HTMLElement, clone: HTMLElement) {
  const live = original.querySelectorAll<HTMLElement>('.wall-col');
  clone.querySelectorAll<HTMLElement>('.wall-col').forEach((column, i) => {
    const source = live[i];
    if (!source) return;
    column.style.animation = 'none';
    column.style.transform = getComputedStyle(source).transform;
  });
  // React writes input values as properties, which cloneNode does not copy.
  const fields = original.querySelectorAll('input');
  clone.querySelectorAll('input').forEach((input, i) => {
    input.value = fields[i]?.value ?? '';
  });
}

function door(root: HTMLElement, rect: DOMRect, side: 'left' | 'right'): HTMLElement {
  const clone = root.cloneNode(true) as HTMLElement;
  freeze(root, clone);
  clone.removeAttribute('data-auth-root');
  Object.assign(clone.style, {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    minHeight: '0',
    margin: '0',
    clipPath: side === 'left' ? 'inset(0 50% 0 0)' : 'inset(0 0 0 50%)',
    transition: `translate ${DURATION_MS}ms ${EASE}`,
    willChange: 'translate',
  });
  // A shadow along the seam, so each half reads as a panel with an edge.
  const edge = document.createElement('div');
  Object.assign(edge.style, {
    position: 'absolute',
    top: '0',
    bottom: '0',
    width: '48px',
    [side === 'left' ? 'right' : 'left']: '50%',
    pointerEvents: 'none',
    background: `linear-gradient(${side === 'left' ? 'to left' : 'to right'}, rgb(0 0 0 / 0.45), transparent)`,
  });
  clone.appendChild(edge);
  return clone;
}

/**
 * Builds the doors over the current auth screen, runs `go` (the navigation)
 * behind them, then opens them. Falls back to a plain `go` when there is no
 * auth screen to split or the viewer asked for reduced motion.
 */
export async function openDoors(go: () => Promise<unknown>): Promise<void> {
  const root = document.querySelector<HTMLElement>('[data-auth-root]');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!root || reduced || opening) {
    await go();
    return;
  }

  opening = true;
  const rect = root.getBoundingClientRect();
  const stage = document.createElement('div');
  stage.setAttribute('aria-hidden', 'true');
  stage.inert = true;
  Object.assign(stage.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '100',
    pointerEvents: 'none',
    overflow: 'hidden',
  });
  const left = door(root, rect, 'left');
  const right = door(root, rect, 'right');
  stage.append(left, right);
  document.body.appendChild(stage);

  try {
    await go();
    window.scrollTo(0, 0);
    await destinationReady(stage);
    // Two frames: the destination paints behind the doors before they move.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    left.style.translate = '-50% 0';
    right.style.translate = '50% 0';
    await new Promise((resolve) => setTimeout(resolve, DURATION_MS + 50));
  } finally {
    stage.remove();
    opening = false;
  }
}
