import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PRISM, color } from '../../src/theme/tokens';

/**
 * The token drift guard (ADR-0008 §5, mobile plan "Verification").
 *
 * NativeWind was rejected, so the design tokens exist twice: as CSS custom
 * properties in `apps/web/src/styles.css` and as a TypeScript object in
 * `src/theme/tokens.ts`. Nothing at build time connects them, so this test does
 * — it reads the hex values straight out of the stylesheet and asserts the port
 * still matches. The accepted cost of the two copies is only acceptable because
 * this fails when someone changes one of them.
 *
 * Only hex values are covered. The `rgba()` surfaces are composited differently
 * on each platform (`backdrop-filter` vs `expo-blur`) and are not the same
 * value by design.
 */

// `.href` rather than the URL object: this project's lib includes the DOM, so
// `new URL()` is the DOM one and `node:url` will not take it.
const STYLES = fileURLToPath(new URL('../../../web/src/styles.css', import.meta.url).href);

/** `--color-on-prism: #14101a;` → `onPrism` → `#14101a`. */
function readCssColors(): Map<string, string> {
  const css = readFileSync(STYLES, 'utf8');
  const found = new Map<string, string>();
  for (const match of css.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-f]{3,8})\s*;/gi)) {
    const [, name, value] = match;
    if (!name || !value) continue;
    const camel = name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
    found.set(camel, value.toLowerCase());
  }
  return found;
}

describe('AURA PRISM token parity with apps/web', () => {
  const css = readCssColors();

  it('finds the web tokens at all — a rename here must not silently pass', () => {
    expect(css.size).toBeGreaterThanOrEqual(11);
    expect(css.get('ink')).toBeDefined();
  });

  it.each(Object.entries(color))('%s matches --color-%s in styles.css', (name, value) => {
    const web = css.get(name);
    expect(web, `--color-${name} is not defined in apps/web/src/styles.css`).toBeDefined();
    expect(value).toBe(web);
  });

  it('covers every hex colour the web app defines', () => {
    const ported = new Set(Object.keys(color));
    const missing = [...css.keys()].filter((name) => !ported.has(name));
    expect(missing, 'ported tokens.ts is missing web colours').toEqual([]);
  });

  it('transcribes the PRISM gradient stops in order', () => {
    const css_ = readFileSync(STYLES, 'utf8');
    const gradient = /--gradient-prism:\s*linear-gradient\(90deg,([^)]+)\)/i.exec(css_);
    expect(gradient?.[1]).toBeDefined();
    const stops = gradient![1]!.split(',').map((s) => s.trim().toLowerCase());
    expect(stops).toEqual(PRISM.map((stop) => stop.toLowerCase()));
  });
});
