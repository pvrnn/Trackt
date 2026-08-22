import { onlineManager } from '@tanstack/react-query';
import * as Network from 'expo-network';
import { useSyncExternalStore } from 'react';
import { isOnlineState } from './offline';

/**
 * Connectivity, as React Query understands it (mobile plan, phase 5).
 *
 * React Query's default `onlineManager` listens for the browser's `online` and
 * `offline` events, which React Native does not fire — so without this the
 * manager reports online forever, `networkMode: 'online'` never pauses
 * anything, and every offline check-in fails instead of queueing. Feeding it
 * from `expo-network` is what turns "no signal" into "paused", and reconnecting
 * is what drains the queue: `QueryClient` resumes paused mutations itself the
 * moment the manager flips back.
 */

/**
 * Point `onlineManager` at the OS. Called once, above the React tree, because
 * the manager is a module singleton and a second subscription would just
 * double-report.
 */
export function startNetworkWatch(): void {
  onlineManager.setEventListener((setOnline) => {
    // The listener only fires on *changes*, so nothing would set the initial
    // value — and the initial value is the one that decides whether the first
    // check-in after a cold launch is sent or queued.
    void Network.getNetworkStateAsync()
      .then((state) => setOnline(isOnlineState(state)))
      .catch(() => setOnline(true));
    const subscription = Network.addNetworkStateListener((state) => {
      setOnline(isOnlineState(state));
    });
    return () => subscription.remove();
  });
}

/**
 * The same reading the query layer is acting on, for the UI that has to explain
 * it (`StaleNotice`, the queued-write copy on the undo toast).
 *
 * Read from `onlineManager` rather than from `expo-network`'s own hook on
 * purpose: a screen that says "offline" while React Query is still happily
 * firing requests — or the reverse — is worse than either state alone.
 */
export function useIsOnline(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => onlineManager.subscribe(onStoreChange),
    () => onlineManager.isOnline(),
    () => true,
  );
}
