import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import type { Persister } from '@tanstack/react-query-persist-client';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import type { MMKV } from 'react-native-mmkv';
import { cacheKeyForOrigin } from './offline';

/**
 * The React Query cache on disk. MMKV rather than AsyncStorage: the persister
 * writes the whole dehydrated cache on a throttle, and MMKV's writes are
 * synchronous and memory-mapped rather than a few hundred KB across the bridge.
 *
 * One instance for the app, keyed inside it by origin — a second instance per
 * origin would leak a file per server the user ever typed in.
 */

/** What the persister needs of a backend, and all either backend provides. */
interface SyncStorage {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/**
 * The cache with nowhere to go, for Expo Go: MMKV 4 is a Nitro module and Expo
 * Go is a prebuilt binary that does not carry it. Everything offline does
 * *within* a session still works against this; what is lost is the part that
 * spans a launch. To develop against, never to ship — hence the warning.
 */
function createMemoryStorage(): SyncStorage {
  const entries = new Map<string, string>();
  return {
    getString: (key) => entries.get(key),
    set: (key, value) => {
      entries.set(key, value);
    },
    remove: (key) => {
      entries.delete(key);
    },
  };
}

let instance: SyncStorage | null = null;

/**
 * Lazy, because `createMMKV` opens the memory-mapped file the moment it is
 * called and this module is imported above the splash. The `require` cannot be
 * a static import: `react-native-mmkv` resolves NitroModules as its module body
 * runs, so a top-level import throws before this can fall back.
 */
function storage(): SyncStorage {
  if (instance) return instance;

  // Asked before requiring, not caught after: MMKV logs the Nitro failure with
  // `console.error` on its way out, which leaves a red LogBox over the app on
  // every launch even when the error is caught.
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    warnMemoryOnly();
    instance = createMemoryStorage();
    return instance;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createMMKV } = require('react-native-mmkv') as {
      createMMKV: (config: { id: string }) => MMKV;
    };
    instance = createMMKV({ id: 'trackt.cache' });
  } catch {
    // A dev or store build missing MMKV is broken rather than expected, and
    // silently serving a cache that evaporates would hide it.
    warnMemoryOnly();
    instance = createMemoryStorage();
  }
  return instance;
}

function warnMemoryOnly(): void {
  console.warn(
    '[trackt] react-native-mmkv is unavailable — the offline cache is in memory only ' +
      'and will not survive a relaunch. Expected in Expo Go; build a dev client ' +
      '(eas build --profile development) for the real thing.',
  );
}

/** Throttle the dump to disk. A burst of check-ins writes once, not eight times. */
const THROTTLE_MS = 1_000;

export function createInstancePersister(origin: string): Persister {
  return createSyncStoragePersister({
    key: cacheKeyForOrigin(origin),
    throttleTime: THROTTLE_MS,
    storage: {
      getItem: (key) => storage().getString(key) ?? null,
      setItem: (key, value) => {
        storage().set(key, value);
      },
      removeItem: (key) => {
        storage().remove(key);
      },
    },
  });
}

/**
 * Drop an instance's cache when the user forgets the instance: the origin is
 * gone from SecureStore by then, so nothing would ever key back in to expire it.
 */
export function clearPersistedCache(origin: string): void {
  storage().remove(cacheKeyForOrigin(origin));
}
