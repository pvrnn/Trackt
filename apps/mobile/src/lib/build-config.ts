import Constants from 'expo-constants';
import { normalizeOrigin } from './instance';

/** The release build's instance. */
const PRODUCTION_INSTANCE = 'https://trackt.party';
/** The dev stack's API as the iOS Simulator sees it; a physical device needs `TRACKT_INSTANCE`. */
const DEVELOPMENT_INSTANCE = 'http://localhost:3001';

/**
 * The one instance this build talks to: `TRACKT_INSTANCE` at build time,
 * otherwise the local dev stack in development and trackt.party in release.
 */
export function buildInstanceOrigin(): string {
  const configured = Constants.expoConfig?.extra?.instance;
  const origin = typeof configured === 'string' ? normalizeOrigin(configured) : null;
  return origin ?? (__DEV__ ? DEVELOPMENT_INSTANCE : PRODUCTION_INSTANCE);
}
