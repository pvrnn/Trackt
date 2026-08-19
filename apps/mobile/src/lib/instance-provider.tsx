import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { configureAuth, resetAuth } from './auth-client';
import { configureMobileClient } from './client';
import { setActiveInstance } from './instance';
import { clearPersistedCache } from './persist';
import { clearStoredOrigin, loadStoredOrigin, storeOrigin } from './storage';

/**
 * Owns "which instance are we talking to", and is the only writer of the three
 * module singletons that answer it: the active origin (`instance.ts`), the auth
 * client (`auth-client.ts`) and the `@trackt/client` runtime (`client.ts`).
 *
 * Keeping the writes in one place is what makes the singletons safe. They exist
 * because the readers are not all hooks — `resolveInstanceUrl` is called from
 * image props and `trackingApi` from event handlers — but a singleton with
 * scattered writers is just a global.
 */

interface InstanceState {
  /** Null until the stored origin has been read back — the app shows a splash. */
  ready: boolean;
  origin: string | null;
  /** Adopt a probed origin: persist it, wire the clients, and re-render. */
  selectInstance: (origin: string) => Promise<void>;
  /** Forget the instance entirely. Signing out of the *app*, not of the account. */
  forgetInstance: () => Promise<void>;
}

const InstanceContext = createContext<InstanceState | null>(null);

/** Point every client at `origin`. Order matters only in that all three must agree. */
function activate(origin: string): void {
  setActiveInstance(origin);
  configureAuth(origin);
  configureMobileClient(origin);
}

export function InstanceProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [origin, setOrigin] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadStoredOrigin().then((stored) => {
      if (cancelled) return;
      if (stored) {
        activate(stored);
        setOrigin(stored);
      }
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectInstance = useCallback(async (next: string) => {
    await storeOrigin(next);
    activate(next);
    setOrigin(next);
  }, []);

  const forgetInstance = useCallback(async () => {
    await clearStoredOrigin();
    // The persisted query cache is keyed by origin (phase 5), and this is the
    // last moment anything knows which key that was — after this the entry
    // would sit in MMKV until its `maxAge` expired it, holding one account's
    // library on a device that has been handed to someone else.
    if (origin) clearPersistedCache(origin);
    setActiveInstance(null);
    resetAuth();
    setOrigin(null);
  }, [origin]);

  const value = useMemo<InstanceState>(
    () => ({ ready, origin, selectInstance, forgetInstance }),
    [ready, origin, selectInstance, forgetInstance],
  );

  return <InstanceContext.Provider value={value}>{children}</InstanceContext.Provider>;
}

export function useInstance(): InstanceState {
  const value = useContext(InstanceContext);
  if (!value) throw new Error('useInstance must be used inside <InstanceProvider>');
  return value;
}
