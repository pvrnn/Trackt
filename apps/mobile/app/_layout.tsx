import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

/**
 * The root layout. A native stack from the start — every push in the app is
 * platform-correct by construction and gets gesture-back for free (ADR-0008 §6),
 * and the tab group phase 2 adds lives inside it.
 *
 * The header is off because AURA PRISM's screens carry their own: a fixed
 * radial aura behind everything with the title over it, not a system bar.
 */
export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0a0710' } }} />
    </>
  );
}
