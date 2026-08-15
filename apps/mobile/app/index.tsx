import { MEDIA_KINDS } from '@trackt/shared';
import { KIND_LABELS } from '@trackt/client';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';

/**
 * Scaffold screen. Phase 1 replaces it with the server picker — this app opens
 * on a server picker, not a login form, because there is no "the server"
 * (ADR-0008 §2).
 *
 * It renders the kind labels on purpose rather than a hardcoded string: that
 * pulls `@trackt/shared` *and* `@trackt/client` through Metro from pnpm's
 * isolated `node_modules`, which is the one thing about this scaffold that can
 * silently be wrong. If the workspace ever needs `nodeLinker: hoisted`
 * (ADR-0008 §1), this screen is where it shows up first.
 */
export default function Index() {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.body}>
        <Text style={styles.wordmark}>TRACKT</Text>
        <Text style={styles.caption}>Scaffold — the server picker lands in phase 1.</Text>
        <Text style={styles.kinds}>{MEDIA_KINDS.map((kind) => KIND_LABELS[kind]).join(' · ')}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0a0710' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  wordmark: { color: '#f4f0ff', fontSize: 40, letterSpacing: 4, fontWeight: '800' },
  caption: { color: '#a89ec4', fontSize: 14, textAlign: 'center' },
  kinds: { color: '#6f6690', fontSize: 11, letterSpacing: 2, textAlign: 'center' },
});
