import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { configureAuth } from './auth-client';
import { buildInstanceOrigin } from './build-config';
import { configureMobileClient } from './client';
import { setActiveInstance } from './instance';

/**
 * Owns "which instance are we talking to", and is the only writer of the three
 * module singletons that answer it: the active origin (`instance.ts`), the auth
 * client (`auth-client.ts`) and the `@trackt/client` runtime (`client.ts`).
 *
 * The instance is fixed per build (`build-config.ts`); there is no picker.
 */

interface InstanceState {
  origin: string;
}

const InstanceContext = createContext<InstanceState | null>(null);

/** Point every client at `origin`. Order matters only in that all three must agree. */
function activate(origin: string): void {
  setActiveInstance(origin);
  configureAuth(origin);
  configureMobileClient(origin);
}

export function InstanceProvider({ children }: { children: ReactNode }) {
  const value = useMemo<InstanceState>(() => {
    const origin = buildInstanceOrigin();
    activate(origin);
    return { origin };
  }, []);

  return <InstanceContext.Provider value={value}>{children}</InstanceContext.Provider>;
}

export function useInstance(): InstanceState {
  const value = useContext(InstanceContext);
  if (!value) throw new Error('useInstance must be used inside <InstanceProvider>');
  return value;
}
