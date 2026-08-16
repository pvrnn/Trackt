import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useInstance } from '../src/lib/instance-provider';
import { useOptionalSession } from '../src/lib/session';
import { color } from '../src/theme/tokens';

/**
 * The entry route: picker → login → app, resolved once at launch.
 *
 * The session half is a child component rather than a branch in this one,
 * because `useOptionalSession` needs an auth client and there is none until an
 * origin exists — a component boundary is what keeps that from being a
 * conditional hook call.
 */
export default function Index() {
  const { origin } = useInstance();
  if (!origin) return <Redirect href="/instance" />;
  return <SignedInRedirect />;
}

function SignedInRedirect() {
  const { isPending, user } = useOptionalSession();
  if (isPending) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={color.pink} />
      </View>
    );
  }
  return <Redirect href={user ? '/home' : '/login'} />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.ink,
  },
});
