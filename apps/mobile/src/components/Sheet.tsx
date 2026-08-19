import { BlurView } from 'expo-blur';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ReactNode } from 'react';
import { color, nativeSurface, space } from '../theme/tokens';
import { type } from '../theme/typography';

/**
 * The bottom sheet every phase-3 write happens in (`Mobile System.dc.html`
 * §05): rating, status, log dates, list add, list edit, profile edit.
 *
 * Built on React Native's own `Modal` rather than a gesture-driven sheet
 * library. `Modal` is the platform's presentation on both OSes — it takes the
 * hardware back button on Android and the system dismiss animation on iOS for
 * free — and every sheet here is a form with a button, not a scrubbable
 * surface. What that costs is detents: the spec's 42%/92% pair becomes a
 * `maxHeight` and content that sizes itself, since a `Modal` has no drag. The
 * grabber is therefore decoration, and is marked as such; drag-to-dismiss is
 * phase 4's gesture pass, along with the swipe check-in.
 *
 * The surface is solid `#191520`, not glass: the sheet covers content the user
 * was just reading, and a translucent panel over a cover grid is unreadable.
 * Only the backdrop is blurred.
 *
 * **Mounted on demand** (`{showing && <Sheet …/>}`) rather than kept mounted
 * behind an `open` flag: several sheets run a query of their own, and one held
 * open={false} on the media screen would fetch the viewer's lists on every
 * title they opened. The cost is the dismiss animation, which needs the element
 * to outlive the state — phase 4 restores it along with the drag.
 */
export function Sheet({
  title,
  subtitle,
  onClose,
  children,
  /** 92% for pickers with a long list; the default 60% suits a short form. */
  tall = false,
}: {
  title: string;
  subtitle?: string | undefined;
  onClose: () => void;
  children: ReactNode;
  tall?: boolean;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      statusBarTranslucent
      // Android's back button, and iOS's swipe-down when the OS provides it.
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        {/* Tap-to-dismiss, per §05. Labelled rather than left as bare chrome:
            with the sheet up it is the only other thing on screen. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Close ${title}`}
          style={styles.backdrop}
          onPress={onClose}
        >
          <BlurView intensity={6} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={styles.scrim} />
        </Pressable>

        <View
          style={[
            styles.sheet,
            { maxHeight: tall ? '92%' : '60%', paddingBottom: insets.bottom + space.lg },
          ]}
        >
          <View accessibilityElementsHidden importantForAccessibility="no" style={styles.grabber} />
          <View style={styles.head}>
            <Text style={[type.section, styles.title]}>{title.toUpperCase()}</Text>
            {subtitle ? (
              <Text style={[type.bodySm, styles.subtitle]} numberOfLines={2}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          <ScrollView
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** The error line a sheet shows when the write came back rejected. */
export function SheetError({ message }: { message: string }) {
  return (
    <Text accessibilityRole="alert" style={[type.bodySm, styles.error]}>
      {message}
    </Text>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: nativeSurface.scrim,
  },
  sheet: {
    backgroundColor: nativeSurface.sheet,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: space.xl,
    paddingTop: 10,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  head: {
    gap: space.xs,
    paddingTop: space.lg,
    paddingBottom: space.md,
  },
  title: {
    color: color.fg,
  },
  subtitle: {
    color: color.muted,
  },
  body: {
    gap: space.lg,
    paddingBottom: space.lg,
  },
  error: {
    color: color.pink,
  },
});
