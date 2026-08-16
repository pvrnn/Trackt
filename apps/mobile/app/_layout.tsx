import { QueryClientProvider } from '@tanstack/react-query';
import { makeQueryClient } from '@trackt/client';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { InstanceProvider, useInstance } from '../src/lib/instance-provider';
import { AuraBackground } from '../src/components/AuraBackground';
import { color } from '../src/theme/tokens';
import { fontAssets } from '../src/theme/typography';

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
    <SafeAreaProvider>
      <InstanceProvider>
        <App />
      </InstanceProvider>
    </SafeAreaProvider>
  );
}

function App() {
  const { ready, origin } = useInstance();
  const [fontsLoaded] = useFonts(fontAssets);
  // One client for the app's lifetime; the defaults (stale times, retry
  // policy) are `@trackt/client`'s, so both clients cache identically.
  const queryClient = useMemo(() => makeQueryClient(), []);

  if (!ready || !fontsLoaded) return <Splash />;

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="light" />
      {/* Remount on instance change: the session store, the query cache
          consumers and every screen's state belong to one server. */}
      <Stack
        key={origin ?? 'no-instance'}
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
    </QueryClientProvider>
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
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.ink,
  },
});
