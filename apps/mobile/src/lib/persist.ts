import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import type { Persister } from '@tanstack/react-query-persist-client';
import { createMMKV } from 'react-native-mmkv';
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
let instance: MMKV | null = null;

/**
 * Lazily, because `createMMKV` opens the memory-mapped file on the native side
 * the moment it is called — and this module is imported by the instance
 * provider, which is above the splash. Nothing should touch the filesystem to
 * satisfy an import.
 */
function storage(): MMKV {
  instance ??= createMMKV({ id: 'trackt.cache' });
  return instance;
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
