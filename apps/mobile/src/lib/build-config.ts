import Constants from 'expo-constants';
import { normalizeOrigin } from './instance';

/**
 * The demo instance this build may offer, or null when it has none.
 * (`app.config.ts`'s `extra` — what the build was compiled with, as opposed to
 * what the user picked, which is `instance-provider.tsx` and always wins.)
 *
 * Normalized rather than trusted: a misconfigured build should offer nothing
 * rather than an address that strands whoever taps it.
 */
export function demoInstanceOrigin(): string | null {
  const configured = Constants.expoConfig?.extra?.demoInstance;
  return typeof configured === 'string' ? normalizeOrigin(configured) : null;
}
