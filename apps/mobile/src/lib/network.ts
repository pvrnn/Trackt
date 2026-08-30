import { onlineManager } from '@tanstack/react-query';
import * as Network from 'expo-network';
import { useSyncExternalStore } from 'react';
import { isOnlineState } from './offline';

/**
 * Point `onlineManager` at the OS, once, above the React tree.
 *
 * React Query's default manager listens for the browser's `online`/`offline`
 * events, which React Native never fires — so without this it reports online
 * forever and every offline check-in fails instead of queueing.
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
 * The same reading the query layer is acting on, for the UI that explains it.
 * Read from `onlineManager`, not `expo-network`: a screen saying "offline"
 * while React Query is still firing requests is worse than either state alone.
 */
export function useIsOnline(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => onlineManager.subscribe(onStoreChange),
    () => onlineManager.isOnline(),
    () => true,
  );
}
