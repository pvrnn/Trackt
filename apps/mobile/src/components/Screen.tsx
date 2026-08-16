import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ReactNode } from 'react';
import { AuraBackground } from './AuraBackground';
import { space } from '../theme/tokens';

/**
 * Every screen's frame: the aura behind, the notch and home indicator avoided,
 * and — for the form screens — the keyboard pushed out of the way.
 *
 * `scroll` defaults on because the auth forms are taller than a small phone
 * with the keyboard up; `contentContainerStyle` centres short content rather
 * than pinning it to the top, which is what the split-screen auth layout does
 * on web with a flex column.
 */
export function Screen({
  children,
  auraIntensity,
  center = false,
}: {
  children: ReactNode;
  /** 1 is the app variant; the auth screens use the brighter panel value. */
  auraIntensity?: number;
  center?: boolean;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <AuraBackground intensity={auraIntensity} />
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.content,
            center && styles.centered,
            { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xl },
          ]}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: space.xl,
    gap: space.xl,
  },
  centered: {
    justifyContent: 'center',
  },
});
