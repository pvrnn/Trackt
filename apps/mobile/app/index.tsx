import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useOptionalSession } from '../src/lib/session';
import { color } from '../src/theme/tokens';

/**
 * The entry route: login → app, resolved once at launch.
 */
export default function Index() {
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
