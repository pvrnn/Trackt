import Constants from 'expo-constants';
import { normalizeOrigin } from './instance';

/**
 * What this build was compiled with (`app.config.ts`'s `extra`), as opposed to
 * what the user picked at runtime — which is `instance-provider.tsx`'s job and
 * always wins.
 */

/**
 * The demo instance the picker may offer, or null when this build has none.
 *
 * Put through `normalizeOrigin` rather than trusted: a misconfigured build
 * should offer nothing, not offer an address that strands whoever taps it on a
 * login screen that can only fail. The app still ships with no default server —
 * the demo is an explicitly labelled choice, and taking it is a tap.
 */
export function demoInstanceOrigin(): string | null {
  const configured = Constants.expoConfig?.extra?.demoInstance;
  return typeof configured === 'string' ? normalizeOrigin(configured) : null;
}
