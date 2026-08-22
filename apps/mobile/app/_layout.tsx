import { QueryClientProvider } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { InstanceProvider, useInstance } from '../src/lib/instance-provider';
import { startNetworkWatch } from '../src/lib/network';
import { PERSIST_BUSTER, PERSIST_MAX_AGE_MS, makeMobileQueryClient } from '../src/lib/offline';
import { createInstancePersister } from '../src/lib/persist';
import { ToastProvider } from '../src/lib/toast';
import { AuraBackground } from '../src/components/AuraBackground';
import { color } from '../src/theme/tokens';
import { fontAssets } from '../src/theme/typography';

// Before the first render, and once: `onlineManager` is a module singleton, and
// what it says on the first frame decides whether a check-in taken straight off
// the splash screen is sent or queued (phase 5).
startNetworkWatch();

/**
 * The app shell (mobile plan, phase 1).
 *
 * Two gates, and they are gates of different kinds. **Instance** is structural:
 * the signed-in routes are not registered at all until an origin exists, so a
 * deep link arriving cold resolves to the picker instead of mounting a screen
 * with no server to fetch from — and, more importantly, nothing can call a hook
 * on an auth client that has not been built yet. **Session** is imperative and
 * per-screen (`useAuthedScreen`), mirroring web's `useAuthedPage`.
 */
export default function RootLayout() {
  return (
    // `GestureHandlerRootView` has to be the outermost view, above the safe-area
    // provider and above anything a `Modal` renders into, or a pan inside a
    // sheet never reaches its detector (phase 4).
    <GestureHandlerRootView style={styles.root}>
      {/* No `<ReducedMotionConfig>`: `ReduceMotion.System` is already what every
          Reanimated animation defaults to, so declaring it changes nothing and
          costs a LogBox warning on every launch ("Reduced motion setting is
          overwritten with mode 'system'") — which is worse than the redundancy
          it was documenting. What the app relies on stands either way: with the
          OS setting on, every `withTiming`/`withSpring` resolves straight to its
          end value (PRD §6), and the few places that must do something
          *different* rather than merely faster — the swipe row's exit — read
          `useReducedMotion()` themselves. */}
      <SafeAreaProvider>
        <InstanceProvider>
          <App />
        </InstanceProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function App() {
  const { ready, origin } = useInstance();
  const [fontsLoaded] = useFonts(fontAssets);

  if (!ready || !fontsLoaded) return <Splash />;

  return (
    // Keyed on the origin, which remounts everything below on an instance
    // change: the query client and its persisted cache, the session store, and
    // every screen's state all belong to one server (phase 5 made that literal
    // — a cache keyed by query name alone would serve one instance's rows to
    // another).
    <CacheProvider key={origin ?? 'no-instance'} origin={origin}>
      <StatusBar style="light" />
      {/* Above the navigator, because the undo toast has to outlive the screen
          that raised it: a check-in from the home tab is undoable while the
          user is already reading the title it belongs to (phase 3). */}
      <ToastProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: color.ink },
            animation: 'fade',
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="(setup)/instance" />
          <Stack.Protected guard={!!origin}>
            <Stack.Screen name="(auth)/login" />
            <Stack.Screen name="(auth)/register" />
            {/* The four-tab shell, and the screens that push over it. The tabs
                animate as a fade; a push should read as a push, so the pushed
                routes take the platform's native stack animation. */}
            <Stack.Screen name="(app)/(tabs)" />
            <Stack.Screen name="(app)/media/[slug]" options={PUSHED} />
            <Stack.Screen name="(app)/news/[slug]" options={PUSHED} />
            <Stack.Screen name="(app)/lists/index" options={PUSHED} />
            <Stack.Screen name="(app)/lists/[id]" options={PUSHED} />
            <Stack.Screen name="(app)/history" options={PUSHED} />
            <Stack.Screen name="(app)/users/[username]" options={PUSHED} />
          </Stack.Protected>
        </Stack>
      </ToastProvider>
    </CacheProvider>
  );
}

/**
 * The query client, and the cache it restores from MMKV and writes back to it
 * (phase 5).
 *
 * The client's defaults (stale times, retry policy) are `@trackt/client`'s, so
 * both clients cache identically; what mobile adds is the tracking
 * `mutationFn`, registered by key so a write restored from disk can find it
 * again. It is built here rather than above so that the key on this component
 * is what replaces it — one client per instance, with no dependency array
 * pretending to express that.
 *
 * Two shapes because there are two situations. With an instance picked, the
 * cache is persisted under that origin's key, restored on launch — which is
 * what lets a screen open on last-known data instead of a spinner — and any
 * write that was paused when the app was killed is resumed the moment the
 * restore lands. With no instance there is nothing to key a cache by and
 * nothing signed in to fetch, so the plain provider is the honest shape: the
 * picker is not a screen with stale data, it is a screen with no data.
 */
function CacheProvider({ origin, children }: { origin: string | null; children: ReactNode }) {
  const client = useMemo(() => makeMobileQueryClient(), []);
  const persistOptions = useMemo(
    () =>
      origin
        ? {
            persister: createInstancePersister(origin),
            maxAge: PERSIST_MAX_AGE_MS,
            buster: PERSIST_BUSTER,
          }
        : null,
    [origin],
  );

  if (!persistOptions) return <QueryClientProvider client={client}>{children}</QueryClientProvider>;

  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={persistOptions}
      // `PersistQueryClientProvider` restores; it does not resume. Without this
      // a check-in taken on the tube and killed with the app sits in the
      // restored cache as `isPaused` forever, and the row it belongs to reads
      // as checked in on a server that never heard about it.
      onSuccess={() => client.resumePausedMutations()}
    >
      {children}
    </PersistQueryClientProvider>
  );
}

/**
 * Pushed screens: the platform's own horizontal transition, and with it the iOS
 * left-edge back swipe and Android's system back — both free, and both wrong to
 * reimplement (`Mobile System.dc.html` §06).
 */
const PUSHED = { animation: 'default', gestureEnabled: true } as const;

/** Shown while SecureStore is read and the three font families load. */
function Splash() {
  return (
    <View style={styles.splash}>
      <AuraBackground />
      <ActivityIndicator color={color.pink} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: color.ink,
  },
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.ink,
  },
});
