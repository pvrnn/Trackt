import * as SecureStore from 'expo-secure-store';

/**
 * The picked instance origin, persisted across launches.
 *
 * SecureStore rather than AsyncStorage even though an origin is not a secret:
 * better-auth's Expo plugin already keeps the session cookie here under the
 * `trackt` prefix, and splitting the two across stores means a restore or a
 * partial wipe can leave a session pointing at no instance — or worse, at a
 * different one.
 */
const ORIGIN_KEY = 'trackt.instance.origin';

export async function loadStoredOrigin(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(ORIGIN_KEY);
  } catch {
    // A corrupt or inaccessible keychain entry means "no instance picked",
    // which lands the user on the picker — the one screen that can fix it.
    return null;
  }
}

export async function storeOrigin(origin: string): Promise<void> {
  await SecureStore.setItemAsync(ORIGIN_KEY, origin);
}

export async function clearStoredOrigin(): Promise<void> {
  await SecureStore.deleteItemAsync(ORIGIN_KEY);
}
