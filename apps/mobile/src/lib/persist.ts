import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import type { Persister } from '@tanstack/react-query-persist-client';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import type { MMKV } from 'react-native-mmkv';
import { cacheKeyForOrigin } from './offline';

/**
 * The React Query cache on disk (mobile plan, phase 5).
 *
 * MMKV rather than AsyncStorage because the persister writes the **whole**
 * dehydrated cache on a throttle, and the whole cache after a session of
 * browsing is a few hundred KB of JSON. AsyncStorage would move that across the
 * bridge on every write; MMKV's are synchronous memory-mapped writes, so the
 * `createSyncStoragePersister` above is a real sync persister rather than an
 * async one pretending.
 *
 * One MMKV instance for the app, keyed *inside* it by origin — see
 * `cacheKeyForOrigin`. A second instance per origin would leak a file per
 * server the user ever typed in.
 */

/** What the persister needs of a backend, and all either backend provides. */
interface SyncStorage {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/**
 * The cache with nowhere to go — used only when MMKV's native module is
 * missing, which in practice means Expo Go.
 *
 * MMKV 4 is a Nitro module: native code compiled into the client, not
 * JavaScript a bundler can ship. Expo Go is a prebuilt binary with a fixed set
 * of native modules and MMKV is not in it, so `require`ing it there throws at
 * import time and takes the root layout down with it. A dev client (the
 * `development` profile in `eas.json`) has it; Expo Go never will.
 *
 * Falling back keeps the app launchable there, and everything offline does
 * *within* a session — `onlineManager` pausing queries, a check-in queued as a
 * value, the undo toast, `StaleNotice` — works against this backend exactly as
 * it does against MMKV, because all of that lives in the query client in
 * memory. What is lost is the part that spans a launch: nothing is restored on
 * open, and a write still queued when the app is killed is gone. That is a
 * degradation to develop against, never one to ship, which is why it says so
 * out loud below.
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
 * Lazily, because `createMMKV` opens the memory-mapped file on the native side
 * the moment it is called — and this module is imported by the instance
 * provider, which is above the splash. Nothing should touch the filesystem to
 * satisfy an import.
 *
 * The `require` is deliberate and cannot be the static import it used to be:
 * `react-native-mmkv` resolves NitroModules as its module body runs, so a
 * top-level import throws where the native module is absent — before any code
 * here gets the chance to fall back.
 */
function storage(): SyncStorage {
  if (instance) return instance;

  // Asked before requiring, not caught after: MMKV logs the Nitro failure with
  // `console.error` on its way out, and a caught error still leaves a red
  // full-screen LogBox over the app on every launch. Expo Go is the one
  // environment we can name in advance, so name it.
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
    // A dev client or a store build missing MMKV is a broken build rather than
    // a known environment, so it falls back too — but it is not expected, and
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
 * Drop an instance's cache. Called when the user forgets the instance — the
 * origin is gone from SecureStore at that point, so nothing would ever key back
 * into this entry to expire it, and it would outlive the account it belongs to.
 */
export function clearPersistedCache(origin: string): void {
  storage().remove(cacheKeyForOrigin(origin));
}
