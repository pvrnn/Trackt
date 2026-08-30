import * as SecureStore from 'expo-secure-store';

/**
 * The picked instance origin. SecureStore rather than AsyncStorage even though
 * an origin is no secret: better-auth's Expo plugin keeps the session cookie
 * here, and splitting the two means a restore can leave a session pointing at
 * no instance — or at a different one.
 */
const ORIGIN_KEY = 'trackt.instance.origin';

export async function loadStoredOrigin(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(ORIGIN_KEY);
  } catch {
    // A corrupt keychain entry means "no instance picked", which lands the
    // user on the picker — the one screen that can fix it.
    return null;
  }
}

export async function storeOrigin(origin: string): Promise<void> {
  await SecureStore.setItemAsync(ORIGIN_KEY, origin);
}

export async function clearStoredOrigin(): Promise<void> {
  await SecureStore.deleteItemAsync(ORIGIN_KEY);
}
