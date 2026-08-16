import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { MEDIA_KINDS } from '@trackt/shared';
import { KIND_LABELS } from '@trackt/client';
import { GlassCard } from '../../src/components/GlassCard';
import { PrismButton } from '../../src/components/PrismButton';
import { PrismText } from '../../src/components/PrismText';
import { Screen } from '../../src/components/Screen';
import { authClient } from '../../src/lib/auth-client';
import { useInstance } from '../../src/lib/instance-provider';
import { CLIENT_VERSION } from '../../src/lib/instance';
import { useAuthedScreen } from '../../src/lib/session';
import { color, space } from '../../src/theme/tokens';
import { type } from '../../src/theme/typography';

/**
 * Phase 1's terminus, and phase 2's starting point: proof that the shell works
 * end to end — instance picked, session established, a gated screen rendering
 * the signed-in user.
 *
 * It deliberately fetches nothing. Every `GET` on this screen belongs to phase
 * 2's `(tabs)/home`, which replaces this file wholesale; adding `useHome()`
 * here would mean writing the home screen twice.
 */
export default function Home() {
  const { origin, forgetInstance } = useInstance();
  const { user, isPending } = useAuthedScreen();

  // Blank shell until the session resolves, and while the gate's redirect to
  // /login lands — same posture as web's authed pages.
  if (isPending || !user) {
    return (
      <Screen center>
        <ActivityIndicator color={color.pink} />
      </Screen>
    );
  }

  async function signOut() {
    await authClient().signOut();
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={[type.eyebrow, styles.eyebrow]}>SIGNED IN</Text>
        <PrismText style={type.title}>{user.name.toUpperCase()}</PrismText>
        <Text style={[type.body, styles.lede]}>@{user.username}</Text>
      </View>

      <GlassCard style={styles.card}>
        <Text style={[type.label, styles.eyebrow]}>INSTANCE</Text>
        <Text style={[type.body, styles.value]}>{origin}</Text>
        <Text style={[type.bodySm, styles.hint]}>App {CLIENT_VERSION}</Text>
      </GlassCard>

      <GlassCard style={styles.card}>
        <Text style={[type.label, styles.eyebrow]}>NEXT</Text>
        <Text style={[type.body, styles.value]}>
          Phase 2 replaces this screen with the six tabs:{' '}
          {MEDIA_KINDS.map((k) => KIND_LABELS[k]).join(' · ')}.
        </Text>
      </GlassCard>

      <View style={styles.actions}>
        <PrismButton label="Sign out" variant="secondary" onPress={() => void signOut()} />
        <PrismButton
          label="Change server"
          variant="secondary"
          onPress={() => void forgetInstance()}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: space.sm,
  },
  eyebrow: {
    color: color.dim,
  },
  lede: {
    color: color.muted,
  },
  card: {
    padding: space.xl,
    gap: space.sm,
  },
  value: {
    color: color.fg,
  },
  hint: {
    color: color.faint,
  },
  actions: {
    gap: space.md,
  },
});
